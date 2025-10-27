const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

// Serve os arquivos estáticos da pasta 'public'
app.use(express.static(path.join(__dirname, '..', 'public')));

// Armazenamento em memória (para simplificar, sem banco de dados por enquanto)
let players = {}; // Guarda os dados dos jogadores
let territories = []; // Guarda os territórios conquistados
let territoryIdCounter = 0; // Contador para IDs de territórios

io.on('connection', (socket) => {
    console.log(`Novo jogador conectado: ${socket.id}`);

    // Quando um jogador se cadastra
    socket.on('joinGame', (playerData) => {
        players[socket.id] = {
            id: socket.id,
            name: playerData.name,
            color: playerData.color, // Cor para identificar no mapa
            position: null,
            distance: 0,
            conquests: 0
        };
        // Envia a lista de jogadores e territórios atuais para o novo jogador
        socket.emit('currentGameState', { players, territories });
        // Notifica os outros jogadores sobre o novo participante
        socket.broadcast.emit('newPlayer', players[socket.id]);
    });

    // Quando o jogador atualiza sua posição
    socket.on('updatePosition', (position) => {
        if (players[socket.id]) {
            players[socket.id].position = position;
            // Transmite a nova posição para todos os outros jogadores
            socket.broadcast.emit('playerMoved', { id: socket.id, position });
        }
    });
    
    // Quando um jogador conquista um território (rota)
    socket.on('conquerTerritory', (territoryData) => {
        if (players[socket.id]) {
            territoryIdCounter++;
            const newTerritory = {
                id: territoryIdCounter, // Adiciona o ID único ao território
                ownerId: socket.id,
                ownerName: players[socket.id].name,
                color: players[socket.id].color,
                path: territoryData.path, // O trajeto da rota conquistada
                name: territoryData.name
            };
            territories.push(newTerritory);
            players[socket.id].conquests++;
            
            // Notifica todos os jogadores sobre a nova conquista
            io.emit('territoryConquered', newTerritory);
            // Envia uma notificação de conquista apenas para o jogador que conquistou
            socket.emit('conquestNotification', { territoryName: territoryData.name });
        }
    });

    // Quando um jogador vence um desafio e toma um território
    socket.on('challengeWon', ({ territoryId }) => {
        const challenger = players[socket.id];
        const territory = territories.find(t => t.id === territoryId);

        if (challenger && territory && territory.ownerId !== challenger.id) {
            const oldOwner = players[territory.ownerId];

            // Atualiza contagem de conquistas
            if (oldOwner) {
                oldOwner.conquests = Math.max(0, oldOwner.conquests - 1);
            }
            challenger.conquests++;

            // Transfere a propriedade
            territory.ownerId = challenger.id;
            territory.ownerName = challenger.name;
            territory.color = challenger.color;

            // Notifica todos os clientes sobre a mudança de dono e atualização do ranking
            io.emit('territoryOwnerChanged', { territory, players });
        }
    });

    // Quando um jogador se desconecta
    socket.on('disconnect', () => {
        console.log(`Jogador desconectado: ${socket.id}`);
        if (players[socket.id]) {
            // Notifica os outros jogadores que este saiu
            socket.broadcast.emit('playerLeft', socket.id);
            delete players[socket.id];
        }
    });
});

server.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
