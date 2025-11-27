// server.js - Serveur de signalisation WebRTC avec Socket.io
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// Configuration CORS pour permettre les connexions depuis votre frontend
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

app.use(cors());
app.use(express.json());

// Structure pour stocker les salles et les utilisateurs
const rooms = new Map();
const users = new Map();

// Route de test
app.get('/', (req, res) => {
  res.json({ 
    message: 'Serveur de visioconférence actif',
    rooms: rooms.size,
    users: users.size,
    timestamp: new Date().toISOString()
  });
});

// Route santé pour les tests
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK',
    rooms: rooms.size,
    users: users.size,
    timestamp: new Date().toISOString()
  });
});

// Route pour obtenir les informations d'une salle
app.get('/api/room/:roomId', (req, res) => {
  const { roomId } = req.params;
  const room = rooms.get(roomId);
  
  if (room) {
    res.json({
      roomId,
      participants: room.participants.size,
      users: Array.from(room.participants.values()).map(p => ({
        id: p.id,
        name: p.name
      }))
    });
  } else {
    res.status(404).json({ error: 'Salle non trouvée' });
  }
});

// Route de diagnostic Metered TURN
app.get('/api/debug-turn', (req, res) => {
  const apiKey = process.env.METERED_API_KEY;
  
  res.json({
    meteredConfigured: !!apiKey,
    apiKeyPresent: !!apiKey,
    apiKeyLength: apiKey ? apiKey.length : 0
  });
});

// Route pour récupérer les credentials TURN depuis Metered API
app.get('/api/turn-credentials', async (req, res) => {
  console.log('🔐 Demande de credentials TURN Metered reçue');
  
  const apiKey = process.env.METERED_API_KEY;
  
  if (!apiKey) {
    console.log('❌ Metered non configuré - API key manquante');
    return res.json({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
      ]
    });
  }

  try {
    console.log('🔄 Récupération des credentials TURN depuis Metered API...');
    
    const response = await fetch(`https://meethub.metered.live/api/v1/turn/credentials?apiKey=${apiKey}`);
    
    if (!response.ok) {
      throw new Error(`Erreur API Metered: ${response.status} ${response.statusText}`);
    }
    
    const iceServers = await response.json();
    
    console.log('✅ Credentials TURN Metered récupérés avec succès');
    console.log(`   Nombre de serveurs: ${iceServers.length}`);
    
    res.json({ iceServers });
    
  } catch (error) {
    console.error('❌ Erreur lors de la récupération des credentials TURN:', error);
    
    // Fallback vers les serveurs STUN publics en cas d'erreur
    res.json({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
      ]
    });
  }
});

// Gestion des connexions Socket.io
io.on('connection', (socket) => {
  console.log(`\n=== NOUVELLE CONNEXION ===`);
  console.log(`Socket ID: ${socket.id}`);
  console.log(`Heure: ${new Date().toLocaleTimeString()}`);

  // Rejoindre une salle
  socket.on('join-room', ({ roomId, userName }) => {
    console.log(`\n📥 JOIN-ROOM reçu`);
    console.log(`   User: ${userName}`);
    console.log(`   Room: ${roomId}`);
    console.log(`   Socket: ${socket.id}`);

    // Vérifier si l'utilisateur est déjà dans une salle
    const existingUser = users.get(socket.id);
    if (existingUser && existingUser.roomId !== roomId) {
      console.log(`   🔄 Utilisateur déjà dans une autre salle, nettoyage...`);
      
      // Quitter l'ancienne salle
      const oldRoom = rooms.get(existingUser.roomId);
      if (oldRoom) {
        oldRoom.participants.delete(socket.id);
        socket.leave(existingUser.roomId);
        
        // Notifier les autres participants
        socket.to(existingUser.roomId).emit('user-left', {
          id: socket.id,
          name: existingUser.name
        });
        
        // Supprimer l'ancienne salle si vide
        if (oldRoom.participants.size === 0) {
          rooms.delete(existingUser.roomId);
          console.log(`   🗑️ Ancienne salle ${existingUser.roomId} supprimée`);
        }
      }
    }

    // Créer la salle si elle n'existe pas
    if (!rooms.has(roomId)) {
      console.log(`   ✨ Création de la salle ${roomId}`);
      rooms.set(roomId, {
        id: roomId,
        participants: new Map(),
        messages: []
      });
    }

    const room = rooms.get(roomId);
    
    // Récupérer les utilisateurs déjà présents AVANT d'ajouter le nouveau
    const existingUsers = Array.from(room.participants.values()).map(p => ({
      id: p.id,
      name: p.name
    }));
    
    console.log(`   👥 Utilisateurs déjà présents: ${existingUsers.length}`);
    existingUsers.forEach(u => console.log(`      - ${u.name} (${u.id})`));

    // Ajouter l'utilisateur à la salle
    const userInfo = {
      id: socket.id,
      name: userName,
      roomId: roomId
    };
    
    room.participants.set(socket.id, userInfo);
    users.set(socket.id, userInfo);
    
    // Rejoindre la room Socket.io
    socket.join(roomId);
    console.log(`   ✅ ${userName} a rejoint la salle ${roomId}`);

    // Envoyer la liste des participants existants au nouvel arrivant
    console.log(`   📤 Envoi de la liste des utilisateurs existants à ${userName}`);
    socket.emit('existing-users', existingUsers);

    // Notifier TOUS les autres utilisateurs (sauf celui qui vient de rejoindre)
    console.log(`   📢 Notification aux autres utilisateurs`);
    socket.to(roomId).emit('user-joined', {
      id: socket.id,
      name: userName
    });

    // Envoyer l'historique des messages
    socket.emit('chat-history', room.messages);
    console.log(`   📜 Historique envoyé: ${room.messages.length} messages`);

    // Confirmation de connexion à la room
    socket.emit('join-room-confirmation', {
      roomId,
      userName,
      success: true,
      timestamp: new Date().toISOString()
    });
    console.log(`   ✅ Confirmation join-room envoyée`);

    console.log(`   📊 État de la salle ${roomId}: ${room.participants.size} participants`);
  });

  // Signalisation WebRTC - Offre
  socket.on('offer', ({ to, offer }) => {
    console.log(`\n📨 OFFRE WebRTC`);
    console.log(`   De: ${socket.id}`);
    console.log(`   À: ${to}`);
    
    const targetUser = users.get(to);
    if (!targetUser) {
      console.log(`   ❌ Utilisateur cible ${to} non trouvé`);
      return;
    }
    
    io.to(to).emit('offer', {
      from: socket.id,
      offer: offer
    });
    console.log(`   ✅ Offre transmise`);
  });

  // Signalisation WebRTC - Réponse
  socket.on('answer', ({ to, answer }) => {
    console.log(`\n📨 RÉPONSE WebRTC`);
    console.log(`   De: ${socket.id}`);
    console.log(`   À: ${to}`);
    
    const targetUser = users.get(to);
    if (!targetUser) {
      console.log(`   ❌ Utilisateur cible ${to} non trouvé`);
      return;
    }
    
    io.to(to).emit('answer', {
      from: socket.id,
      answer: answer
    });
    console.log(`   ✅ Réponse transmise`);
  });

  // Signalisation WebRTC - Candidat ICE
  socket.on('ice-candidate', ({ to, candidate }) => {
    console.log(`🧊 ICE CANDIDATE: ${socket.id} → ${to}`);
    
    const targetUser = users.get(to);
    if (!targetUser) {
      console.log(`   ❌ Utilisateur cible ${to} non trouvé`);
      return;
    }
    
    io.to(to).emit('ice-candidate', {
      from: socket.id,
      candidate: candidate
    });
  });

  // Message de chat
  socket.on('chat-message', ({ roomId, message }) => {
    console.log(`\n💬 MESSAGE CHAT`);
    console.log(`   Room: ${roomId}`);
    console.log(`   Texte: ${message}`);
    console.log(`   De: ${socket.id}`);
    
    const user = users.get(socket.id);
    if (!user) {
      console.log(`   ❌ Utilisateur non trouvé`);
      return;
    }

    const room = rooms.get(roomId);
    if (!room) {
      console.log(`   ❌ Salle ${roomId} non trouvée`);
      return;
    }

    // Vérifier que l'utilisateur est bien dans cette salle
    if (!room.participants.has(socket.id)) {
      console.log(`   ❌ Utilisateur ${socket.id} n'est pas dans la salle ${roomId}`);
      return;
    }

    const chatMessage = {
      id: Date.now(),
      sender: user.name,
      senderId: socket.id,
      text: message,
      time: new Date().toISOString()
    };

    // Sauvegarder le message dans la salle
    room.messages.push(chatMessage);
    // Limiter l'historique à 100 messages
    if (room.messages.length > 100) {
      room.messages.shift();
    }
    console.log(`   💾 Message sauvegardé dans la salle`);

    // Diffuser le message à TOUS les participants de la salle (y compris l'expéditeur)
    console.log(`   📢 Diffusion du message à toute la salle ${roomId}`);
    io.to(roomId).emit('chat-message', chatMessage);
    console.log(`   ✅ Message diffusé`);
  });

  // Toggle vidéo
  socket.on('toggle-video', ({ roomId, isVideoOn }) => {
    console.log(`📹 TOGGLE VIDEO: ${socket.id} → ${isVideoOn}`);
    
    const room = rooms.get(roomId);
    if (!room || !room.participants.has(socket.id)) {
      console.log(`   ❌ Salle ou utilisateur non valide`);
      return;
    }
    
    socket.to(roomId).emit('user-video-toggle', {
      userId: socket.id,
      isVideoOn
    });
  });

  // Toggle audio
  socket.on('toggle-audio', ({ roomId, isAudioOn }) => {
    console.log(`🎤 TOGGLE AUDIO: ${socket.id} → ${isAudioOn}`);
    
    const room = rooms.get(roomId);
    if (!room || !room.participants.has(socket.id)) {
      console.log(`   ❌ Salle ou utilisateur non valide`);
      return;
    }
    
    socket.to(roomId).emit('user-audio-toggle', {
      userId: socket.id,
      isAudioOn
    });
  });

  // Partage d'écran
  socket.on('screen-share-start', ({ roomId }) => {
    console.log(`🖥️ PARTAGE ÉCRAN DÉMARRÉ: ${socket.id}`);
    
    const room = rooms.get(roomId);
    if (!room || !room.participants.has(socket.id)) {
      console.log(`   ❌ Salle ou utilisateur non valide`);
      return;
    }
    
    socket.to(roomId).emit('user-screen-share-start', {
      userId: socket.id
    });
  });

  socket.on('screen-share-stop', ({ roomId }) => {
    console.log(`🖥️ PARTAGE ÉCRAN ARRÊTÉ: ${socket.id}`);
    
    const room = rooms.get(roomId);
    if (!room || !room.participants.has(socket.id)) {
      console.log(`   ❌ Salle ou utilisateur non valide`);
      return;
    }
    
    socket.to(roomId).emit('user-screen-share-stop', {
      userId: socket.id
    });
  });

  // Déconnexion
  socket.on('disconnect', (reason) => {
    console.log(`\n❌ DÉCONNEXION: ${socket.id}`);
    console.log(`   Raison: ${reason}`);
    
    const user = users.get(socket.id);
    if (user) {
      const { roomId, name } = user;
      const room = rooms.get(roomId);

      if (room) {
        room.participants.delete(socket.id);
        
        // Notifier les autres participants
        socket.to(roomId).emit('user-left', {
          id: socket.id,
          name: name
        });
        console.log(`   📢 Autres participants notifiés dans ${roomId}`);

        // Supprimer la salle si elle est vide
        if (room.participants.size === 0) {
          rooms.delete(roomId);
          console.log(`   🗑️ Salle ${roomId} supprimée (vide)`);
        } else {
          console.log(`   📊 Salle ${roomId}: ${room.participants.size} participants restants`);
        }
      }

      users.delete(socket.id);
    }
  });

  // Quitter une salle
  socket.on('leave-room', ({ roomId }) => {
    console.log(`\n🚪 LEAVE-ROOM: ${socket.id} quitte ${roomId}`);
    
    const user = users.get(socket.id);
    if (user && user.roomId === roomId) {
      const room = rooms.get(roomId);
      
      if (room) {
        room.participants.delete(socket.id);
        socket.leave(roomId);
        
        socket.to(roomId).emit('user-left', {
          id: socket.id,
          name: user.name
        });
        console.log(`   📢 Notification envoyée aux autres participants`);

        if (room.participants.size === 0) {
          rooms.delete(roomId);
          console.log(`   🗑️ Salle ${roomId} supprimée (vide)`);
        } else {
          console.log(`   📊 Salle ${roomId}: ${room.participants.size} participants restants`);
        }
      }
      
      users.delete(socket.id);
    }
  });

  // Gestion des erreurs
  socket.on('error', (error) => {
    console.error(`❌ ERREUR SOCKET ${socket.id}:`, error);
  });
});

// Nettoyage périodique des salles vides (toutes les 5 minutes)
setInterval(() => {
  let cleanedCount = 0;
  const now = Date.now();
  
  for (const [roomId, room] of rooms.entries()) {
    if (room.participants.size === 0) {
      // Vérifier aussi si la salle est ancienne (plus de 1 heure sans activité)
      const lastActivity = room.messages.length > 0 
        ? new Date(room.messages[room.messages.length - 1].time).getTime()
        : now;
      
      if (room.participants.size === 0 || (now - lastActivity) > 60 * 60 * 1000) {
        rooms.delete(roomId);
        cleanedCount++;
      }
    }
  }
  
  if (cleanedCount > 0) {
    console.log(`\n🧹 Nettoyage: ${cleanedCount} salle(s) vide(s) supprimée(s)`);
  }
}, 5 * 60 * 1000);

// Gestion gracieuse de l'arrêt
process.on('SIGTERM', () => {
  console.log('\n⚠️  Arrêt du serveur demandé...');
  server.close(() => {
    console.log('✅ Serveur arrêté gracieusement');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\n⚠️  Arrêt du serveur (Ctrl+C)...');
  server.close(() => {
    console.log('✅ Serveur arrêté gracieusement');
    process.exit(0);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`\n╔═══════════════════════════════════════╗`);
  console.log(`║   🚀 SERVEUR MEETHUB PRO DÉMARRÉ     ║`);
  console.log(`╚═══════════════════════════════════════╝`);
  console.log(`📡 Port: ${PORT}`);
  console.log(`🌐 WebSocket: Prêt`);
  console.log(`🔐 TURN: ${process.env.METERED_API_KEY ? 'Metered Configuré' : 'Non configuré'}`);
  console.log(`⏰ Heure: ${new Date().toLocaleString('fr-FR')}`);
  console.log(`\n✅ En attente de connexions...\n`);
});

// Export pour les tests
module.exports = { app, server, io, rooms, users };
