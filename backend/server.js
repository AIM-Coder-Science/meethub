// server.js - Serveur de signalisation WebRTC avec Socket.io
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

// Configuration du stockage des fichiers
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|pdf|mp3|wav|ogg|webm|mp4/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('Type de fichier non autorisé'));
  }
});

// Configuration CORS
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  maxHttpBufferSize: 1e8 // 100MB pour les fichiers
});

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// Structure pour stocker les salles et les utilisateurs
const rooms = new Map();
const users = new Map();

// Route de test
app.get('/', (req, res) => {
  res.json({ 
    message: 'Serveur de visioconférence MeetHub Pro actif',
    rooms: rooms.size,
    users: users.size,
    timestamp: new Date().toISOString()
  });
});

// Route santé
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

// Upload de fichiers
app.post('/api/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Aucun fichier fourni' });
    }
    
    const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    res.json({
      success: true,
      fileUrl,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      fileType: req.file.mimetype
    });
  } catch (error) {
    console.error('Erreur upload:', error);
    res.status(500).json({ error: 'Erreur lors de l\'upload' });
  }
});

// Route pour générer les credentials TURN
app.get('/api/turn-credentials', (req, res) => {
  console.log('🔐 Demande de credentials TURN reçue');
  
  const credentials = {
    iceServers: [
      // STUN Google (fiable et gratuit)
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
      
      // STUN publics alternatifs
      { urls: 'stun:stun.voipbuster.com:3478' },
      { urls: 'stun:stun.voipstunt.com:3478' },
      
      // TURN Twilio (ajoutez vos credentials ici)
      { 
        urls: 'turn:global.turn.twilio.com:3478?transport=udp',
        username: process.env.TWILIO_ACCOUNT_SID || 'TWILIO_ACCOUNT_SID',
        credential: process.env.TWILIO_AUTH_TOKEN || 'TWILIO_AUTH_TOKEN'
      },
      { 
        urls: 'turn:global.turn.twilio.com:3478?transport=tcp',
        username: process.env.TWILIO_ACCOUNT_SID || 'TWILIO_ACCOUNT_SID',
        credential: process.env.TWILIO_AUTH_TOKEN || 'TWILIO_AUTH_TOKEN'
      },
      { 
        urls: 'turn:global.turn.twilio.com:443?transport=tcp',
        username: process.env.TWILIO_ACCOUNT_SID || 'TWILIO_ACCOUNT_SID',
        credential: process.env.TWILIO_AUTH_TOKEN || 'TWILIO_AUTH_TOKEN'
      },
      
      // TURN openrelay (gratuit)
      { 
        urls: 'turn:openrelay.metered.ca:80',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      },
      { 
        urls: 'turn:openrelay.metered.ca:443',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      },
      { 
        urls: 'turn:openrelay.metered.ca:443?transport=tcp',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      },
      
      // TURN metered.ca
      { 
        urls: 'turn:global.relay.metered.ca:80',
        username: 'd4682bb48701b55009b58f1c',
        credential: 'Ujx2pj32ryDG3G1R'
      },
      { 
        urls: 'turn:global.relay.metered.ca:443',
        username: 'd4682bb48701b55009b58f1c',
        credential: 'Ujx2pj32ryDG3G1R'
      },
      { 
        urls: 'turn:global.relay.metered.ca:443?transport=tcp',
        username: 'd4682bb48701b55009b58f1c',
        credential: 'Ujx2pj32ryDG3G1R'
      }
    ]
  };

  console.log('✅ Configuration TURN générée');
  console.log(`   Nombre total de serveurs ICE: ${credentials.iceServers.length}`);
  
  res.json(credentials);
});

// Gestion des connexions Socket.io
io.on('connection', (socket) => {
  console.log(`\n=== NOUVELLE CONNEXION ===`);
  console.log(`Socket ID: ${socket.id}`);
  console.log(`Heure: ${new Date().toLocaleTimeString()}`);

  // Rejoindre une salle
  socket.on('join-room', ({ roomId, userName }) => {
    // Validation des paramètres
    if (!roomId || !userName || typeof roomId !== 'string' || typeof userName !== 'string') {
      console.log(`   ❌ Paramètres invalides pour join-room`);
      socket.emit('join-room-confirmation', {
        success: false,
        error: 'Paramètres invalides: roomId et userName sont requis'
      });
      return;
    }

    // Nettoyer les espaces
    const cleanRoomId = roomId.trim().toUpperCase();
    const cleanUserName = userName.trim();
    
    if (!cleanRoomId || !cleanUserName) {
      console.log(`   ❌ Paramètres vides après nettoyage`);
      socket.emit('join-room-confirmation', {
        success: false,
        error: 'roomId et userName ne peuvent pas être vides'
      });
      return;
    }

    console.log(`\n📥 JOIN-ROOM reçu`);
    console.log(`   User: ${cleanUserName}`);
    console.log(`   Room: ${cleanRoomId}`);
    console.log(`   Socket: ${socket.id}`);

    const existingUser = users.get(socket.id);
    if (existingUser && existingUser.roomId !== cleanRoomId) {
      console.log(`   🔄 Utilisateur déjà dans une autre salle, nettoyage...`);
      
      const oldRoom = rooms.get(existingUser.roomId);
      if (oldRoom) {
        oldRoom.participants.delete(socket.id);
        socket.leave(existingUser.roomId);
        
        socket.to(existingUser.roomId).emit('user-left', {
          id: socket.id,
          name: existingUser.name
        });
        
        if (oldRoom.participants.size === 0) {
          rooms.delete(existingUser.roomId);
          console.log(`   🗑️ Ancienne salle ${existingUser.roomId} supprimée`);
        }
      }
    }

    if (!rooms.has(cleanRoomId)) {
      console.log(`   ✨ Création de la salle ${cleanRoomId}`);
      rooms.set(cleanRoomId, {
        id: cleanRoomId,
        participants: new Map(),
        messages: [],
        pinnedMessages: []
      });
    }

    const room = rooms.get(cleanRoomId);
    
    const existingUsers = Array.from(room.participants.values()).map(p => ({
      id: p.id,
      name: p.name
    }));
    
    console.log(`   👥 Utilisateurs déjà présents: ${existingUsers.length}`);

    const userInfo = {
      id: socket.id,
      name: cleanUserName,
      roomId: cleanRoomId
    };
    
    room.participants.set(socket.id, userInfo);
    users.set(socket.id, userInfo);
    
    socket.join(cleanRoomId);
    console.log(`   ✅ ${cleanUserName} a rejoint la salle ${cleanRoomId}`);

    socket.emit('existing-users', existingUsers);

    socket.to(cleanRoomId).emit('user-joined', {
      id: socket.id,
      name: cleanUserName
    });

    socket.emit('chat-history', room.messages);
    socket.emit('pinned-messages', room.pinnedMessages);
    
    socket.emit('join-room-confirmation', {
      roomId: cleanRoomId,
      userName: cleanUserName,
      success: true,
      timestamp: new Date().toISOString()
    });

    console.log(`   📊 État de la salle ${cleanRoomId}: ${room.participants.size} participants`);
  });

  // Signalisation WebRTC
  socket.on('offer', ({ to, offer }) => {
    console.log(`\n📨 OFFRE WebRTC: ${socket.id} → ${to}`);
    io.to(to).emit('offer', { from: socket.id, offer });
  });

  socket.on('answer', ({ to, answer }) => {
    console.log(`\n📨 RÉPONSE WebRTC: ${socket.id} → ${to}`);
    io.to(to).emit('answer', { from: socket.id, answer });
  });

  socket.on('ice-candidate', ({ to, candidate }) => {
    console.log(`🧊 ICE CANDIDATE: ${socket.id} → ${to}`);
    io.to(to).emit('ice-candidate', { from: socket.id, candidate });
  });

  // Message de chat
  socket.on('chat-message', ({ roomId, message, fileUrl, fileName, fileType, fileSize }) => {
    console.log(`\n💬 MESSAGE CHAT`);
    console.log(`   Room: ${roomId}`);
    console.log(`   Texte: ${message}`);
    console.log(`   De: ${socket.id}`);
    
    const user = users.get(socket.id);
    if (!user) return;

    const room = rooms.get(roomId);
    if (!room || !room.participants.has(socket.id)) return;

    const chatMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      sender: user.name,
      senderId: socket.id,
      text: message,
      fileUrl,
      fileName,
      fileType,
      fileSize,
      time: new Date().toISOString(),
      reactions: {},
      isPinned: false,
      isEdited: false
    };

    room.messages.push(chatMessage);
    if (room.messages.length > 200) {
      room.messages.shift();
    }

    io.to(roomId).emit('chat-message', chatMessage);
  });

  // Éditer un message
  socket.on('edit-message', ({ roomId, messageId, newText }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    const message = room.messages.find(m => m.id === messageId);
    if (message && message.senderId === socket.id) {
      message.text = newText;
      message.isEdited = true;
      io.to(roomId).emit('message-edited', { messageId, newText });
    }
  });

  // Supprimer un message
  socket.on('delete-message', ({ roomId, messageId }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    const messageIndex = room.messages.findIndex(m => m.id === messageId);
    if (messageIndex !== -1 && room.messages[messageIndex].senderId === socket.id) {
      room.messages.splice(messageIndex, 1);
      io.to(roomId).emit('message-deleted', { messageId });
    }
  });

  // Réaction à un message
  socket.on('react-message', ({ roomId, messageId, reaction }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    const message = room.messages.find(m => m.id === messageId);
    if (message) {
      // Initialiser reactions si nécessaire
      if (!message.reactions) {
        message.reactions = {};
      }
      
      // Supprimer toutes les réactions existantes de cet utilisateur
      Object.keys(message.reactions).forEach(emoji => {
        if (Array.isArray(message.reactions[emoji])) {
          const userIndex = message.reactions[emoji].indexOf(socket.id);
          if (userIndex !== -1) {
            message.reactions[emoji].splice(userIndex, 1);
            // Supprimer la clé si le tableau est vide
            if (message.reactions[emoji].length === 0) {
              delete message.reactions[emoji];
            }
          }
        }
      });
      
      // Si la nouvelle réaction est différente de celles supprimées, l'ajouter
      if (reaction) {
        // Vérifier si l'utilisateur avait déjà cette réaction (si c'est le cas, elle a été supprimée, donc on ne la rajoute pas)
        // Sinon, ajouter la nouvelle réaction
        if (!message.reactions[reaction]) {
          message.reactions[reaction] = [];
        }
        
        // Ajouter l'utilisateur seulement s'il n'est pas déjà dans la liste (cas limite)
        if (!message.reactions[reaction].includes(socket.id)) {
          message.reactions[reaction].push(socket.id);
        }
      }
      
      io.to(roomId).emit('message-reacted', { 
        messageId, 
        reactions: message.reactions 
      });
    }
  });

  // Épingler un message
  socket.on('pin-message', ({ roomId, messageId }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    const message = room.messages.find(m => m.id === messageId);
    if (message) {
      message.isPinned = !message.isPinned;
      
      if (message.isPinned) {
        room.pinnedMessages.push(message);
      } else {
        room.pinnedMessages = room.pinnedMessages.filter(m => m.id !== messageId);
      }
      
      io.to(roomId).emit('message-pinned', { 
        messageId, 
        isPinned: message.isPinned,
        pinnedMessages: room.pinnedMessages
      });
    }
  });

  // Toggle vidéo
  socket.on('toggle-video', ({ roomId, isVideoOn }) => {
    const user = users.get(socket.id);
    if (!user) return;
    
    socket.to(roomId).emit('user-video-toggle', {
      userId: socket.id,
      userName: user.name,
      isVideoOn
    });
    
    console.log(`🎥 Vidéo ${isVideoOn ? 'activée' : 'désactivée'} par ${user.name} dans ${roomId}`);
  });

  // Toggle audio
  socket.on('toggle-audio', ({ roomId, isAudioOn }) => {
    socket.to(roomId).emit('user-audio-toggle', {
      userId: socket.id,
      isAudioOn
    });
  });

  // Partage d'écran
  socket.on('screen-share-start', ({ roomId }) => {
    console.log(`🖥️ PARTAGE ÉCRAN DÉMARRÉ: ${socket.id}`);
    socket.to(roomId).emit('user-screen-share-start', { userId: socket.id });
  });

  socket.on('screen-share-stop', ({ roomId }) => {
    console.log(`🖥️ PARTAGE ÉCRAN ARRÊTÉ: ${socket.id}`);
    socket.to(roomId).emit('user-screen-share-stop', { userId: socket.id });
  });

  // Offre de partage d'écran
  socket.on('screen-offer', ({ to, offer }) => {
    console.log(`📺 OFFRE ÉCRAN: ${socket.id} → ${to}`);
    io.to(to).emit('screen-offer', { from: socket.id, offer });
  });

  socket.on('screen-answer', ({ to, answer }) => {
    console.log(`📺 RÉPONSE ÉCRAN: ${socket.id} → ${to}`);
    io.to(to).emit('screen-answer', { from: socket.id, answer });
  });

  socket.on('screen-ice-candidate', ({ to, candidate }) => {
    console.log(`🧊 ICE ÉCRAN: ${socket.id} → ${to}`);
    io.to(to).emit('screen-ice-candidate', { from: socket.id, candidate });
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
        
        socket.to(roomId).emit('user-left', {
          id: socket.id,
          name: name
        });

        if (room.participants.size === 0) {
          rooms.delete(roomId);
          console.log(`   🗑️ Salle ${roomId} supprimée (vide)`);
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

        if (room.participants.size === 0) {
          rooms.delete(roomId);
        }
      }
      
      users.delete(socket.id);
    }
  });

  socket.on('error', (error) => {
    console.error(`❌ ERREUR SOCKET ${socket.id}:`, error);
  });
});

// Nettoyage périodique
setInterval(() => {
  let cleanedCount = 0;
  const now = Date.now();
  const INACTIVITY_TIMEOUT = 60 * 60 * 1000; // 1 heure
  
  for (const [roomId, room] of rooms.entries()) {
    if (room.participants.size === 0) {
      const lastActivity = room.messages.length > 0 
        ? new Date(room.messages[room.messages.length - 1].time).getTime()
        : now;
      
      if ((now - lastActivity) > INACTIVITY_TIMEOUT) {
        rooms.delete(roomId);
        cleanedCount++;
        console.log(`   🗑️ Salle ${roomId} supprimée (inactivité > 1h)`);
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
  console.log(`🔐 TURN: Services configurés`);
  console.log(`⏰ Heure: ${new Date().toLocaleString('fr-FR')}`);
  console.log(`\n✅ En attente de connexions...\n`);
});

module.exports = { app, server, io, rooms, users };