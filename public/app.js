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
    const startRaceBtn = document.getElementById('start-race-btn');
    const notificationElement = document.getElementById('notification');
    
    let map;
    let playerMarker;
    let otherPlayerMarkers = {};
    let territoryPolygons = [];
    let drawingManager;
    let myPlayerId;

    // Sons
    const conquestSound = new Audio('https://www.soundjay.com/buttons/sounds/button-7.mp3'); // Som de exemplo

    // --- LÓGICA DE LOGIN ---
    joinButton.addEventListener('click', () => {
        const name = playerNameInput.value.trim();
        if (name) {
            const playerColor = getRandomColor();
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
        startLocationTracking();
        startRaceBtn.textContent = 'Corrida em andamento...';
        startRaceBtn.disabled = true;
        showNotification('Corrida iniciada! Boa sorte!', 'info');
    });

    // --- RASTREAMENTO E GEOLOCALIZAÇÃO ---
    function startLocationTracking() {
        if (navigator.geolocation) {
            navigator.geolocation.watchPosition(
                (position) => {
                    const pos = {
                        lat: position.coords.latitude,
                        lng: position.coords.longitude,
                    };

                    // Atualiza a posição do marcador do jogador
                    if (!playerMarker) {
                        playerMarker = new google.maps.Marker({
                            position: pos,
                            map: map,
                            icon: {
                                path: google.maps.SymbolPath.CIRCLE,
                                scale: 8,
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

                    // Envia a nova posição para o servidor
                    socket.emit('updatePosition', pos);
                },
                () => {
                    alert('Erro: O serviço de geolocalização falhou.');
                },
                { enableHighAccuracy: true }
            );
        } else {
            alert('Erro: Seu navegador não suporta geolocalização.');
        }
    }
    
    // --- LÓGICA DE DESENHO DE TERRITÓRIO ---
    function setupDrawingManager() {
        drawingManager = new google.maps.drawing.DrawingManager({
            drawingMode: google.maps.drawing.OverlayType.POLYLINE,
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
        conquestSound.play();
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
                    scale: 7,
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
