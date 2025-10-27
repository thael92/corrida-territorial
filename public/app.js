// Aguarda o carregamento completo do DOM
document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    // Elementos da UI
    const loginScreen = document.getElementById('login-screen');
    const gameScreen = document.getElementById('game-screen');
    const joinButton = document.getElementById('join-button');
    const playerNameInput = document.getElementById('player-name');
    const mapElement = document.getElementById('map');
    const rankingList = document.getElementById('ranking-list');
    const hudDistance = document.getElementById('hud-distance');
    const startRaceBtn = document.getElementById('start-race-btn');
    const notificationElement = document.getElementById('notification');
    
    let map;
    let playerMarker;
    let otherPlayerMarkers = {};
    let territoryPolygons = [];
    let drawingManager;
    let myPlayerId;
    
    // Variáveis da corrida
    let raceInProgress = false;
    let currentRacePath = [];
    let totalDistance = 0;
    let isFirstPosition = true; // Flag para garantir que o primeiro ponto seja o de partida
    let racePathPolyline;
    let watchId;

    // Sons
    const conquestSound = new Audio('https://www.soundjay.com/buttons/sounds/button-7.mp3'); // Som de exemplo

    // --- LÓGICA DE LOGIN ---
    joinButton.addEventListener('click', () => {
        const name = playerNameInput.value.trim();
        if (name) {
            const playerColor = getRandomColor(); // myPlayerColor will be set by socket.on('currentGameState') or 'newPlayer'
            socket.emit('joinGame', { name, color: playerColor });
            
            loginScreen.classList.remove('active');
            gameScreen.classList.add('active');
            
            initMap();
        } else {
            alert('Por favor, digite seu nome!');
        }
    });

    // --- INICIALIZAÇÃO DO MAPA ---
    function initMap() {
        // Posição inicial (ex: centro de uma cidade grande)
        const initialPosition = { lat: -23.55052, lng: -46.633308 }; 

        map = new google.maps.Map(mapElement, {
            center: initialPosition,
            zoom: 15,
            mapTypeId: 'roadmap',
            disableDefaultUI: true,
            styles: [ /* Estilos de mapa customizados (opcional) */ ]
        });

        // Configura o Drawing Manager para criar rotas/territórios
        setupDrawingManager();
    }

    // --- LÓGICA DA CORRIDA ---
    startRaceBtn.addEventListener('click', () => {
        if (raceInProgress) return; // Previne múltiplos cliques

        // Resetar o estado da corrida para uma nova
        resetRaceState(); // Chama para limpar qualquer estado anterior
        
        // Inicia a nova corrida
        raceInProgress = true;
        isFirstPosition = true; // Garante que o primeiro ponto será o de partida
        startLocationTracking();

        // Atualiza UI
        startRaceBtn.textContent = 'Corrida em andamento...';
        startRaceBtn.style.backgroundColor = '#c5c5c5';
        startRaceBtn.style.cursor = 'not-allowed';
        showNotification('Corrida iniciada! Boa sorte!', 'info');
        
        // Desativa o modo de desenho manual durante a corrida
        drawingManager.setDrawingMode(null);
        drawingManager.setOptions({ drawingControl: false }); // Esconde os controles de desenho
    });

    // --- RASTREAMENTO E GEOLOCALIZAÇÃO ---
    function startLocationTracking() {
        if (navigator.geolocation) {
            watchId = navigator.geolocation.watchPosition(
                (position) => {
                    if (!raceInProgress) {
                        // Se a corrida foi resetada por algum motivo, para de rastrear
                        navigator.geolocation.clearWatch(watchId);
                        return;
                    }
                    const pos = {
                        lat: position.coords.latitude,
                        lng: position.coords.longitude,
                    };

                    // Atualiza a posição do marcador do jogador
                    // e adiciona o ponto ao trajeto da corrida
                    if (isFirstPosition) {
                        currentRacePath = [pos]; // Define o primeiro ponto como o de partida
                        isFirstPosition = false;
                    } else {
                        currentRacePath.push(pos);
                    }


                    if (!playerMarker) {
                        playerMarker = new google.maps.Marker({
                            position: pos,
                            map: map,
                            icon: {
                                path: google.maps.SymbolPath.CIRCLE,
                                scale: 10, // Marcador um pouco maior para o jogador atual
                                fillColor: players[myPlayerId]?.color || '#1E90FF',
                                fillOpacity: 1,
                                strokeColor: 'white',
                                strokeWeight: 2,
                            },
                        });
                        map.setCenter(pos);
                    } else {
                        playerMarker.setPosition(pos);
                    }

                    // Atualiza a polyline do percurso
                    updateRacePathPolyline();

                    // Calcula e exibe a distância em tempo real
                    if (currentRacePath.length > 1) {
                        totalDistance = google.maps.geometry.spherical.computeLength(racePathPolyline.getPath()) / 1000; // em km
                        hudDistance.textContent = `Distância: ${totalDistance.toFixed(2)} km`;
                    }

                    // Envia a nova posição para o servidor
                    socket.emit('updatePosition', pos);
                    // Verifica se o jogador fechou o percurso
                    checkIfRaceIsComplete();
                },
                (error) => {
                    console.error('Erro de geolocalização:', error);
                    alert('Erro: O serviço de geolocalização falhou. Por favor, verifique as permissões do navegador.');
                    resetRaceState(); // Reseta o estado da corrida em caso de erro
                },
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 } // Opções para melhor precisão e resposta
            );
        } else {
            alert('Erro: Seu navegador não suporta geolocalização.');
            resetRaceState(); // Reseta o estado se a geolocalização não for suportada
        }
    }

    function updateRacePathPolyline() {
        if (!racePathPolyline) {
            racePathPolyline = new google.maps.Polyline({
                path: currentRacePath,
                geodesic: true,
                strokeColor: players[myPlayerId]?.color || '#FFC107', // Usa a cor do jogador para o trajeto
                strokeOpacity: 1.0,
                strokeWeight: 4,
                map: map
            });
        } else {
            racePathPolyline.setPath(currentRacePath);
        }
    }

    function checkIfRaceIsComplete() {
        if (currentRacePath.length < 3) return; // Precisa de pelo menos 3 pontos para formar uma área

        const startPoint = currentRacePath[0];
        const currentPoint = currentRacePath[currentRacePath.length - 1];

        const distance = google.maps.geometry.spherical.computeDistanceBetween(
            new google.maps.LatLng(startPoint),
            new google.maps.LatLng(currentPoint)
        );

        // Se o jogador estiver a menos de 25 metros do início, considera o percurso fechado
        if (distance < 25) {
            navigator.geolocation.clearWatch(watchId); // Para de rastrear
            raceInProgress = false;
 
            const territoryName = prompt(`Percurso de ${totalDistance.toFixed(2)} km completo! Dê um nome para este território:`, "Minha Conquista");
            if (territoryName) {
                socket.emit('conquerTerritory', { name: territoryName, path: currentRacePath });
                // A notificação de sucesso será acionada pelo evento 'conquestNotification' do servidor
            } else {
                // Se o usuário cancelar o prompt, apenas reseta a corrida
                showNotification('Conquista cancelada.', 'info');
            }
 
            resetRaceState(); // Reseta o estado da corrida para poder iniciar uma nova
        }
    }

    // Função para resetar o estado da corrida
    function resetRaceState() {
        if (watchId) {
            navigator.geolocation.clearWatch(watchId);
            watchId = null;
        }
        raceInProgress = false;
        currentRacePath = [];
        totalDistance = 0;
        hudDistance.textContent = 'Distância: 0.00 km';
        if (racePathPolyline) {
            racePathPolyline.setMap(null);
            racePathPolyline = null;
        }
        startRaceBtn.textContent = 'Iniciar Corrida';
        startRaceBtn.style.backgroundColor = 'var(--secondary-color)';
        startRaceBtn.style.cursor = 'pointer';
        drawingManager.setOptions({ drawingControl: true }); // Mostra os controles de desenho novamente
    }

    // --- LÓGICA DE DESENHO DE TERRITÓRIO ---
    function setupDrawingManager() {
        drawingManager = new google.maps.drawing.DrawingManager({
            drawingControl: true,
            drawingControlOptions: {
                position: google.maps.ControlPosition.TOP_CENTER,
                drawingModes: ['polyline'],
            },
            polylineOptions: {
                strokeColor: '#FFC107',
                strokeWeight: 5,
                editable: true,
            },
        });
        drawingManager.setMap(map);

        google.maps.event.addListener(drawingManager, 'polylinecomplete', (polyline) => {
            // Se uma corrida estiver em andamento, não permite o desenho manual
            if (raceInProgress) return; // Não permite desenho manual durante a corrida

            const territoryName = prompt("Dê um nome para esta rota conquistada:", "Minha Rota");
            if (territoryName) {
                const path = polyline.getPath().getArray().map(p => ({ lat: p.lat(), lng: p.lng() }));
                socket.emit('conquerTerritory', { name: territoryName, path });
            }
            polyline.setMap(null); // Remove o desenho temporário
        });
    }

    // --- EVENTOS DO SOCKET.IO ---
    socket.on('connect', () => {
        myPlayerId = socket.id;
    });

    socket.on('currentGameState', ({ players: serverPlayers, territories: serverTerritories }) => {
        window.players = serverPlayers; // Torna acessível globalmente no script
        updateRanking();
        
        // Desenha territórios existentes
        serverTerritories.forEach(drawTerritory);
        
        // Desenha outros jogadores
        for (const id in serverPlayers) {
            if (id !== myPlayerId && serverPlayers[id].position) {
                updateOtherPlayerMarker(serverPlayers[id]);
            }
        }
    });

    socket.on('newPlayer', (player) => {
        window.players[player.id] = player;
        updateRanking();
        showNotification(`${player.name} entrou no jogo!`, 'info');
    });

    socket.on('playerLeft', (playerId) => {
        const playerName = window.players[playerId]?.name || 'Um jogador';
        if (otherPlayerMarkers[playerId]) {
            otherPlayerMarkers[playerId].setMap(null);
            delete otherPlayerMarkers[playerId];
        }
        delete window.players[playerId];
        updateRanking();
        showNotification(`${playerName} saiu.`, 'info');
    });

    socket.on('playerMoved', (data) => {
        if (window.players[data.id]) {
            window.players[data.id].position = data.position;
            updateOtherPlayerMarker(window.players[data.id]);
        }
    });
    
    socket.on('territoryConquered', (territory) => {
        drawTerritory(territory);
        // Atualiza contagem de conquistas do jogador
        if (window.players[territory.ownerId]) {
            window.players[territory.ownerId].conquests++;
            updateRanking();
        }
    });
    
    socket.on('conquestNotification', ({ territoryName }) => {
        showNotification(`🏆 Território "${territoryName}" conquistado!`);
        conquestSound.play().catch(e => console.log("Erro ao tocar som:", e)); // Adiciona catch para evitar erro de Promise não tratada
    });

    // --- FUNÇÕES AUXILIARES DA UI ---
    function updateRanking() {
        rankingList.innerHTML = '';
        const sortedPlayers = Object.values(window.players).sort((a, b) => b.conquests - a.conquests);
        
        sortedPlayers.forEach(player => {
            const li = document.createElement('li');
            li.textContent = `- ${player.name} (${player.conquests} conquistas)`;
            li.style.color = player.color;
            rankingList.appendChild(li);
        });
    }

    function updateOtherPlayerMarker(player) {
        if (!otherPlayerMarkers[player.id]) {
            otherPlayerMarkers[player.id] = new google.maps.Marker({
                position: player.position,
                map: map,
                icon: {
                    path: google.maps.SymbolPath.CIRCLE,
                    scale: 8, // Marcador um pouco menor para outros jogadores
                    fillColor: player.color,
                    fillOpacity: 0.8,
                    strokeColor: 'black',
                    strokeWeight: 1,
                },
                title: player.name
            });
        } else {
            otherPlayerMarkers[player.id].setPosition(player.position);
        }
    }
    
    function drawTerritory(territory) {
        const territoryPath = new google.maps.Polygon({
            paths: territory.path,
            strokeColor: territory.color,
            strokeOpacity: 0.8,
            strokeWeight: 2,
            fillColor: territory.color,
            fillOpacity: 0.35,
            map: map,
        });
        territoryPolygons.push(territoryPath);
    }

    function showNotification(message, type = 'success') {
        notificationElement.textContent = message;
        notificationElement.className = type === 'success' ? '' : 'info';
        notificationElement.classList.remove('hidden');
        
        // Esconde a notificação após alguns segundos
        setTimeout(() => {
            notificationElement.classList.add('hidden');
        }, 4000);
    }
    
    function getRandomColor() {
        const letters = '0123456789ABCDEF';
        let color = '#';
        for (let i = 0; i < 6; i++) {
            color += letters[Math.floor(Math.random() * 16)];
        }
        return color;
    }
});
// Adicione no final de public/app.js, fora do 'DOMContentLoaded'
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js').then(registration => {
            console.log('ServiceWorker registrado com sucesso: ', registration.scope);
        }).catch(error => {
            console.log('Falha no registro do ServiceWorker: ', error);
        });
    });
}
