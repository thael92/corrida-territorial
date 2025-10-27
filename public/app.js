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
    const challengeRaceBtn = document.getElementById('challenge-race-btn');
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

    // Variáveis do desafio
    let challengeMode = false;
    let selectedTerritory = null;
    let selectedTerritoryPolyline = null;

    // Sons
    // CORREÇÃO: Substituído URL externo por um caminho local para evitar ERR_CONNECTION_TIMED_OUT
    const conquestSound = new Audio('/sounds/conquest.mp3'); 

    // --- FUNÇÕES AUXILIARES DE ESCOPO ---

    // CORREÇÃO: Função movida para o topo do escopo do DOMContentLoaded
    // para resolver o "Uncaught ReferenceError: getRandomColor is not defined"
    function getRandomColor() {
        const vibrantColors = [
            '#FF5733', '#33FF57', '#3357FF',
            '#FF33A1', '#A133FF', '#33FFF3',
            '#F8C33F', '#B6FF33', '#FF3333'
        ];
        return vibrantColors[Math.floor(Math.random() * vibrantColors.length)];
    }

    // Função para resetar o estado da corrida (Definida no escopo externo para ser usada em múltiplos locais)
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
        startRaceBtn.style.display = 'block';

        // Reseta o modo desafio
        challengeMode = false;
        selectedTerritory = null;
        if (selectedTerritoryPolyline) {
            selectedTerritoryPolyline.setOptions({ strokeColor: selectedTerritory.color, strokeWeight: 2 }); // Volta à cor/espessura normal
            selectedTerritoryPolyline = null;
        }
        challengeRaceBtn.style.display = 'none';

        drawingManager.setOptions({ drawingControl: true }); // Mostra os controles de desenho novamente
    }

    function showNotification(message, type = 'success') {
        notificationElement.textContent = message;
        notificationElement.className = type; // Aplica a classe 'success', 'info' ou 'error'
        notificationElement.classList.remove('hidden');

        // Esconde a notificação após alguns segundos
        setTimeout(() => {
            notificationElement.classList.add('hidden');
        }, 4000);
    }

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
            showNotification('Por favor, digite seu nome!', 'error');
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
            styles: [ /* Estilos de mapa customizados (opcional) */]
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

    challengeRaceBtn.addEventListener('click', () => {
        if (raceInProgress || !selectedTerritory) return;

        resetRaceState();

        raceInProgress = true;
        challengeMode = true;
        isFirstPosition = true;
        startLocationTracking();

        // Atualiza UI para modo desafio
        challengeRaceBtn.textContent = 'Desafio em andamento...';
        challengeRaceBtn.style.backgroundColor = '#c5c5c5';
        challengeRaceBtn.style.cursor = 'not-allowed';
        startRaceBtn.style.display = 'none'; // Esconde o botão de corrida normal

        showNotification(`Desafio iniciado! Corra até o final do percurso de ${selectedTerritory.ownerName}.`, 'info');
        drawingManager.setDrawingMode(null);
        drawingManager.setOptions({ drawingControl: false });
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
                        // players é global, então está acessível
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
                    showNotification('Geolocalização falhou. Verifique as permissões.', 'error');
                    resetRaceState(); // Reseta o estado da corrida em caso de erro
                },
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 } // Opções para melhor precisão e resposta
            );
        } else {
            showNotification('Seu navegador não suporta geolocalização.', 'error');
            resetRaceState(); // Reseta o estado se a geolocalização não for suportada
        }
    }

    function updateRacePathPolyline() {
        // players é global, então está acessível
        if (!racePathPolyline) {
            racePathPolyline = new google.maps.Polyline({
                path: currentRacePath,
                geodesic: true,
                strokeColor: window.players[myPlayerId]?.color || '#FFC107', // Usa a cor do jogador para o trajeto
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

        const distanceToStart = google.maps.geometry.spherical.computeDistanceBetween(
            new google.maps.LatLng(startPoint.lat, startPoint.lng),
            new google.maps.LatLng(currentPoint.lat, currentPoint.lng)
        );

        // Define uma distância mínima (em km) para que uma corrida seja válida para conquista.
        const MINIMUM_RACE_DISTANCE_KM = 0.1; // 100 metros

        if (challengeMode) {
            // Lógica para completar um desafio
            const challengeEndPoint = selectedTerritory.path[selectedTerritory.path.length - 1];
            const distanceToEnd = google.maps.geometry.spherical.computeDistanceBetween(
                new google.maps.LatLng(currentPoint.lat, currentPoint.lng),
                new google.maps.LatLng(challengeEndPoint.lat, challengeEndPoint.lng)
            );

            if (distanceToEnd < 25) { // Chegou perto do fim do percurso desafiado (25 metros)
                navigator.geolocation.clearWatch(watchId);
                raceInProgress = false;

                showNotification(`🏆 Desafio completo! Você conquistou o território de ${selectedTerritory.ownerName}!`);
                socket.emit('challengeWon', { territoryId: selectedTerritory.id });

                resetRaceState();
            }
        } else {
            // Lógica para conquista normal (fechar o próprio percurso)
            if (distanceToStart < 25 && totalDistance > MINIMUM_RACE_DISTANCE_KM) {
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

    socket.on('territoryOwnerChanged', ({ territory: updatedTerritory, players: updatedPlayers }) => {
        // Encontra o polígono no mapa e atualiza sua cor
        const polygonToUpdate = territoryPolygons.find(p => p.territoryData.id === updatedTerritory.id);
        if (polygonToUpdate) {
            polygonToUpdate.setOptions({
                fillColor: updatedTerritory.color,
                strokeColor: updatedTerritory.color
            });
            polygonToUpdate.territoryData = updatedTerritory; // Atualiza os dados internos
        }
        window.players = updatedPlayers;
        updateRanking();
    });

    socket.on('conquestNotification', ({ territoryName }) => {
        showNotification(`🏆 Território "${territoryName}" conquistado!`);
        conquestSound.play().catch(e => console.log("Erro ao tocar som:", e)); // Adiciona catch para evitar erro de Promise não tratada
    });

    // --- FUNÇÕES AUXILIARES DA UI ---
    function updateRanking() {
        rankingList.innerHTML = '';
        const sortedPlayers = Object.values(window.players).sort((a, b) => b.conquests - a.conquests);

        // Atualiza o nome do jogador no HUD principal
        if (window.players[myPlayerId]) {
            document.getElementById('hud-player-name').textContent = window.players[myPlayerId].name;
        }

        sortedPlayers.forEach(player => {
            const li = document.createElement('li');

            const colorIndicator = document.createElement('span');
            colorIndicator.style.display = 'inline-block';
            colorIndicator.style.width = '12px';
            colorIndicator.style.height = '12px';
            colorIndicator.style.borderRadius = '50%'; // Para um indicador circular
            colorIndicator.style.backgroundColor = player.color;
            colorIndicator.style.marginRight = '8px';
            colorIndicator.style.verticalAlign = 'middle'; // Alinha com o texto
            colorIndicator.style.border = '1px solid rgba(255,255,255,0.3)'; // Pequena borda para visibilidade

            li.appendChild(colorIndicator);
            li.appendChild(document.createTextNode(`${player.name} (${player.conquests} conquistas)`));
            // Removemos li.style.color = player.color; para que o texto herde a cor padrão (clara) do CSS
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
            clickable: true
        });

        territoryPath.territoryData = territory; // Armazena os dados do território no objeto do polígono
        territoryPolygons.push(territoryPath);

        google.maps.event.addListener(territoryPath, 'click', function () {
            // Não permite selecionar o próprio território ou durante uma corrida
            if (raceInProgress || this.territoryData.ownerId === myPlayerId) {
                return;
            }

            // Reseta a seleção anterior
            if (selectedTerritoryPolyline) {
                // É necessário garantir que selectedTerritory não é null (verificado no escopo de click)
                selectedTerritoryPolyline.setOptions({ strokeColor: selectedTerritory.color, strokeWeight: 2 });
            }

            // Seleciona o novo território
            selectedTerritory = this.territoryData;
            selectedTerritoryPolyline = this;
            this.setOptions({ strokeColor: '#FFFFFF', strokeWeight: 4 }); // Destaca o território selecionado

            showNotification(`Território "${selectedTerritory.name}" selecionado para desafio!`, 'info');

            // Mostra o botão de desafio
            startRaceBtn.style.display = 'none';
            challengeRaceBtn.style.display = 'block';
            challengeRaceBtn.textContent = 'Iniciar Desafio';
            challengeRaceBtn.style.backgroundColor = 'var(--error-color)'; // Cor de desafio
            challengeRaceBtn.style.cursor = 'pointer';
        });
    }

}); // ← fecha corretamente o DOMContentLoaded

// Adicione no final de public/app.js, fora do 'DOMContentLoaded'
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js')
            .then(registration => {
                console.log('ServiceWorker registrado com sucesso: ', registration.scope);
            })
            .catch(error => {
                console.log('Falha no registro do ServiceWorker: ', error);
            });
    });
}