/**
 * INTEGRATION EXAMPLE: How to use WebRTCCore.js in App.js
 * 
 * This shows the exact socket.io event handlers and component logic
 * needed to integrate the production-grade WebRTC architecture.
 */

// ============================================================
// 1. IMPORT AT TOP OF App.js
// ============================================================

import {
  createPeerConnection,
  handleOffer,
  handleAnswer,
  handleIceCandidate,
  startScreenShare,
  stopScreenShare,
  cleanupPeerData
} from './WebRTCCore';

// ============================================================
// 2. ADD THESE REFS TO YOUR COMPONENT STATE
// ============================================================

const originalCameraTracksRef = useRef({}); // Store original camera before screen
const pendingIceCandidatesRef = useRef({}); // Queue for ICE candidates
const remoteDescriptionSetRef = useRef({}); // Track remoteDescription status

// Perfect Negotiation flags
const makingOfferRef = useRef({});
const ignoreOfferRef = useRef({});
const isPolitePeerRef = useRef({});

// ============================================================
// 3. IN YOUR SOCKET.IO INITIALIZATION
// ============================================================

useEffect(() => {
  socketRef.current = io(SOCKET_SERVER_URL, {
    transports: ['polling', 'websocket'],
    reconnectionAttempts: 10,
    timeout: 20000
  });

  socketRef.current.on('connect', () => {
    console.log('✅ Connected to server');
    setConnectionStatus('Connecté');
  });

  // ====== NEGOTIATION EVENTS ======

  socketRef.current.on('offer', async ({ from, offer }) => {
    console.log('[SOCKET] Offer received from', from);
    await handleOffer(from, offer);
  });

  socketRef.current.on('answer', async ({ from, answer }) => {
    console.log('[SOCKET] Answer received from', from);
    await handleAnswer(from, answer);
  });

  socketRef.current.on('ice-candidate', async ({ from, candidate }) => {
    console.log('[SOCKET] ICE candidate from', from);
    await handleIceCandidate(from, candidate);
  });

  // ====== PARTICIPANT MANAGEMENT ======

  socketRef.current.on('new-user', async (user) => {
    console.log('[SOCKET] New user:', user.id);
    
    // I am the initiator
    const pc = await createPeerConnection(user.id, true, iceServers);
    
    if (pc && localStreamRef.current) {
      // Add local media
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current);
      });
    }
    
    // Trigger negotiation
    if (pc) {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        
        socketRef.current.emit('offer', {
          to: user.id,
          offer: pc.localDescription.toJSON()
        });
      } catch (error) {
        console.error('Error creating initial offer:', error);
      }
    }
  });

  socketRef.current.on('user-joined', (user) => {
    console.log('[SOCKET] User joined:', user.id);
    
    setParticipants(prev => [...prev, {
      id: user.id,
      name: user.name,
      isLocal: false,
      isCreator: user.isCreator
    }]);
  });

  socketRef.current.on('user-left', (user) => {
    console.log('[SOCKET] User left:', user.id);
    
    // Clean up peer connection
    cleanupPeerData(user.id);
    
    // Remove from participants list
    removeParticipant(user.id);
    
    // Remove remote stream UI
    setRemoteStreams(prev => {
      const updated = { ...prev };
      delete updated[user.id];
      return updated;
    });
  });

  socketRef.current.on('user-screen-share-start', ({ userId }) => {
    console.log('[SOCKET] User screen share started:', userId);
    // The screen track is already being sent via replaceTrack()
    // Just update UI to show screen tile
  });

  socketRef.current.on('user-screen-share-stop', ({ userId }) => {
    console.log('[SOCKET] User screen share stopped:', userId);
    // Camera track is already restored via replaceTrack()
    // Just update UI to hide screen tile
  });

  // ====== CLEANUP ======

  return () => {
    if (socketRef.current) {
      socketRef.current.disconnect();
    }
    
    // Close all peer connections
    Object.values(peersRef.current).forEach(pc => {
      if (pc) pc.close();
    });
  };
}, [iceServers]);

// ============================================================
// 4. REPLACE SCREEN SHARE TOGGLE
// ============================================================

const toggleScreenShare = async () => {
  if (isScreenSharing) {
    await stopScreenShare();
  } else {
    await startScreenShare();
  }
};

// (DELETE THE OLD createScreenPeerConnection FUNCTION)

// ============================================================
// 5. HANDLE LOCAL MEDIA (START OF CALL)
// ============================================================

const startLocalMedia = async () => {
  try {
    console.log('🎥 Starting local media...');
    
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: true
    });
    
    localStreamRef.current = stream;
    
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
    }
    
    console.log('✅ Local media started');
  } catch (error) {
    console.error('❌ Error getting local media:', error);
  }
};

// ============================================================
// 6. REMOVE THESE OLD FUNCTIONS
// ============================================================

// DELETE:
// - createScreenPeerConnection()
// - All screen-specific socket handlers (screen-offer, screen-answer, screen-ice-candidate)
// - screenPeersRef and screenVideosRef

// ============================================================
// 7. CLEANUP ON LEAVE ROOM
// ============================================================

const leaveRoom = () => {
  console.log('🚪 Leaving room...');
  
  // Stop local media
  if (localStreamRef.current) {
    localStreamRef.current.getTracks().forEach(track => track.stop());
    localStreamRef.current = null;
  }
  
  // Stop screen share if active
  if (isScreenSharing) {
    stopScreenShare();
  }
  
  // Close all peer connections
  Object.entries(peersRef.current).forEach(([peerId, pc]) => {
    cleanupPeerData(peerId);
  });
  
  // Emit socket event
  socketRef.current?.emit('leave-room', { roomId });
  
  // Reset state
  setIsInRoom(false);
  setParticipants([]);
  setRemoteStreams({});
};

// ============================================================
// 8. EXPECTED PROPS/STATE PASSED TO WebRTCCore
// ============================================================

// WebRTCCore.js expects these to be available in closure:
// - socketRef (Socket.IO instance)
// - peersRef (Map of RTCPeerConnection objects)
// - localStreamRef (Local media stream)
// - screenStreamRef (Screen media stream)
// - remoteVideosRef (Map of video elements)
// - setRemoteStreams (React state setter)
// - setIsScreenSharing (React state setter)
// - iceServers (Array of ICE server configs)

// Make sure these refs are passed correctly when calling WebRTCCore functions!

// ============================================================
// 9. RENDERING VIDEO TILES (NO CHANGES TO STRUCTURE)
// ============================================================

// The rendering logic stays mostly the same:
// - Show local video in localVideoRef
// - Show remote videos from remoteStreams
// - Show screen shares in separate tiles
// The difference: Screen streams now come from the SAME PeerConnection
// (via the ontrack event after replaceTrack)

// Example:
// {participants.map(p => (
//   <div key={p.id} className="video-tile">
//     <video ref={ref => remoteVideosRef.current[p.id] = ref} autoPlay playsInline />
//   </div>
// ))}

// For screen shares, you might add a separate map or detect stream type from ontrack

// ============================================================
// 10. DEBUGGING: ENABLE DETAILED LOGGING
// ============================================================

// In WebRTCCore.js, you'll see logs like:
// [PC] Creating PeerConnection...
// [OFFER] Received from peer123
// [SCREEN] Screen track sent to peer123 via replaceTrack
// [ICE] Candidate flushed for peer123

// Monitor these in browser console or server logs to verify
// the refactored architecture is working correctly.

// ============================================================
