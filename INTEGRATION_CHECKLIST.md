# QUICK INTEGRATION CHECKLIST

## Files Created
- ✅ `frontend/src/WebRTCCore.js` — Core 7 functions (production-grade)
- ✅ `WEBRTC_REFACTOR_GUIDE.md` — Full implementation guide
- ✅ `ARCHITECTURE_COMPARISON.md` — Before/after diagrams and metrics
- ✅ `INTEGRATION_EXAMPLE.js` — Copy-paste integration code
- ✅ This checklist

---

## What to Delete from App.js

```javascript
// DELETE THESE REFS
❌ const screenPeersRef = useRef({});
❌ const screenVideosRef = useRef({});

// DELETE THESE FUNCTIONS
❌ createScreenPeerConnection()
❌ removeScreenPeer()

// DELETE THESE SOCKET HANDLERS
❌ socketRef.current.on('user-screen-share-start', ...)
❌ socketRef.current.on('user-screen-share-stop', ...)
❌ socketRef.current.on('screen-offer', ...)
❌ socketRef.current.on('screen-answer', ...)
❌ socketRef.current.on('screen-ice-candidate', ...)
❌ socketRef.current.on('screen-share-start', ...)
❌ socketRef.current.on('screen-share-stop', ...)
```

---

## What to Add to App.js

### 1. Imports (at top)
```javascript
import {
  createPeerConnection,
  handleOffer,
  handleAnswer,
  handleIceCandidate,
  startScreenShare,
  stopScreenShare,
  cleanupPeerData
} from './WebRTCCore';
```

### 2. Refs (in component)
```javascript
const originalCameraTracksRef = useRef({});
const pendingIceCandidatesRef = useRef({});
const remoteDescriptionSetRef = useRef({});

// Perfect Negotiation
const makingOfferRef = useRef({});
const ignoreOfferRef = useRef({});
const isPolitePeerRef = useRef({});
```

### 3. Socket Handlers (in socket.io setup)
```javascript
socketRef.current.on('offer', async ({ from, offer }) => {
  await handleOffer(from, offer);
});

socketRef.current.on('answer', async ({ from, answer }) => {
  await handleAnswer(from, answer);
});

socketRef.current.on('ice-candidate', async ({ from, candidate }) => {
  await handleIceCandidate(from, candidate);
});

socketRef.current.on('new-user', async (user) => {
  const pc = await createPeerConnection(user.id, true, iceServers);
  if (pc && localStreamRef.current) {
    localStreamRef.current.getTracks().forEach(track => {
      pc.addTrack(track, localStreamRef.current);
    });
  }
});

socketRef.current.on('user-left', (user) => {
  cleanupPeerData(user.id);
});
```

### 4. Screen Share Toggle
```javascript
const toggleScreenShare = async () => {
  if (isScreenSharing) {
    await stopScreenShare();
  } else {
    await startScreenShare();
  }
};

// (OLD createScreenPeerConnection logic DELETED)
```

---

## Testing Checklist

### Test 1: Basic Connection
- [ ] Participant A joins
- [ ] Participant B joins
- [ ] A's video visible in B (and vice versa)
- [ ] Check logs: `[PC] Creating PeerConnection...` ✅

### Test 2: Screen Share Start
- [ ] A clicks "Share Screen"
- [ ] Screen visible to B (no audio from screen)
- [ ] Logs show: `[SCREEN] ✅ Screen track sent via replaceTrack`
- [ ] **NO** logs showing: `[PC] onnegotiationneeded` (would be bad!)
- [ ] A's participant tile still shows camera (optional PiP)

### Test 3: Screen Share Stop
- [ ] A clicks "Stop Sharing"
- [ ] A's camera restored to B
- [ ] Logs show: `[SCREEN] ✅ Camera track restored`
- [ ] No InvalidStateError in console

### Test 4: Collision Handling
- [ ] (Advanced) Simulate slow network on A
- [ ] A creates offer (have-local-offer state)
- [ ] B simultaneously sends offer → collision
- [ ] Logs show: `[OFFER] Collision detected`
- [ ] Connection establishes without error
- [ ] No InvalidStateError

### Test 5: Mobile Network
- [ ] Test on real mobile device (or DevTools throttling)
- [ ] Throttle to "Fast 3G"
- [ ] Verify connection still works
- [ ] Screen share latency < 500ms
- [ ] No state machine errors

### Test 6: Cleanup
- [ ] A leaves room
- [ ] Logs show: `[CLEANUP] Cleaning up peer`
- [ ] B's participant list updates
- [ ] No memory leaks (check DevTools Memory tab)

---

## Debugging Quick Fixes

### Issue: `Cannot read property 'addTrack' of null`

**Fix**: Ensure `localStreamRef.current` is set before calling `createPeerConnection`

```javascript
// In new-user handler
if (pc && localStreamRef.current) {  // ← Check both exist
  localStreamRef.current.getTracks().forEach(track => {
    pc.addTrack(track, localStreamRef.current);
  });
}
```

---

### Issue: Screen share appears as static/frozen

**Fix**: Ensure `remoteVideosRef[peerId]` is attached to HTML `<video>` element

```javascript
setTimeout(() => {
  const videoElement = remoteVideosRef.current[peerId];
  if (videoElement && stream) {
    videoElement.srcObject = stream;  // ← Attach to video element
  }
}, 100);
```

---

### Issue: `Unknown ufrag` error for ICE candidates

**Fix**: Ensure candidates are flushed AFTER `setRemoteDescription`

```javascript
// In handleOffer
await pc.setRemoteDescription(new RTCSessionDescription(offer));
await flushPendingIceCandidates(peerId, pc);  // ← AFTER remoteDescription
```

---

### Issue: Screen share not showing on remote side

**Fix**: Ensure screen track sent to ALL peers (loop in `startScreenShare`)

```javascript
for (const [peerId, pc] of peers) {
  if (!pc || pc.connectionState === 'closed') continue;  // ← Skip closed PCs
  
  const senders = await pc.getSenders();
  const videoSender = senders.find(s => s.track?.kind === 'video');
  
  if (videoSender) {
    await videoSender.replaceTrack(screenTrack);
  }
}
```

---

## Performance Checklist

- [ ] CPU usage < 15% on single call
- [ ] Memory < 200MB on single call
- [ ] Connection time < 3 seconds
- [ ] Screen share latency < 100ms
- [ ] No renegotiations (count = 0)
- [ ] No InvalidStateError in console

---

## Production Pre-Flight

- [ ] All tests passing ✅
- [ ] No console errors ✅
- [ ] Logs show correct sequence ([PC] → [OFFER] → [ANSWER] → [PC] ✅)
- [ ] Screen share tested on ≥2 devices ✅
- [ ] Mobile network tested ✅
- [ ] Cleanup verified (leave room, check remoteStreams empty) ✅
- [ ] WebRTCCore.js in git ✅
- [ ] App.js updated with new handlers ✅
- [ ] No references to `screenPeersRef` remain ✅
- [ ] Deployment plan reviewed ✅

---

## Code Review Checklist

**For someone reviewing your changes:**

- [ ] WebRTCCore.js has 7 functions: createPeerConnection, handleOffer, handleAnswer, handleIceCandidate, startScreenShare, stopScreenShare, cleanupPeerData
- [ ] Each function has inline comments explaining the WHY
- [ ] No `new RTCPeerConnection()` in error handlers
- [ ] No `screenPeersRef` anywhere
- [ ] All socket handlers wire correctly to new functions
- [ ] Perfect Negotiation flags (makingOffer, ignoreOffer, isPolite) properly initialized
- [ ] ICE candidate queuing logic present and correct
- [ ] replaceTrack() used for screen sharing (not new PC)
- [ ] cleanupPeerData called when user leaves
- [ ] No memory leaks (refs properly cleared)

---

## When Things Go Wrong

### Step 1: Check the Logs
```
[PC] Creating PeerConnection... ← Should see this
[OFFER] Received from peer123
[OFFER] ✅ remoteDescription set ← Should see this
[ANSWER] ✅ Connection negotiation complete ← Should see this
```

If you don't see these, check socket.io events are wired correctly.

### Step 2: Check Browser Console
```
✅ No InvalidStateError
✅ No "Cannot add ICE candidate"
✅ No "Unknown ufrag"
```

If you see these, check Perfect Negotiation refs initialization.

### Step 3: Check Chrome WebRTC Internals
Open `chrome://webrtc-internals`
- [ ] ONE RTCPeerConnection per participant (not two!)
- [ ] iceConnectionState: checking → connected
- [ ] signalingState: stable → have-local-offer → stable
- [ ] connectionState: new → connecting → connected

### Step 4: Monitor Network
Open DevTools → Network tab → Filter by "offer"/"answer"
- [ ] Offer sent first
- [ ] Answer received
- [ ] ICE candidates trickling

If order is wrong, check socket emit order.

### Step 5: Ask for Help
If still stuck, collect:
1. Browser console logs (search for `[PC]` and `[SCREEN]`)
2. Chrome webrtc-internals dump
3. Browser/OS version
4. Network conditions (mobile/desktop/VPN)
5. Steps to reproduce

---

## Success Indicators

✅ You'll know it's working when:

1. **Logs show clean sequence** (no errors)
2. **Screen share is instant** (< 100ms latency)
3. **CPU stays low** (< 15%)
4. **No InvalidStateError** ever appears
5. **Reconnection is smooth** (no state machine hangs)
6. **Mobile works** (3G/4G/5G)
7. **Behind NAT works** (TURN servers engaged)
8. **Multiple users stable** (3+ participants, all connected)

---

## Next Step

**START HERE**: Open `WEBRTC_REFACTOR_GUIDE.md` and read the full context.

Then follow **Integration Checklist** step by step.

Good luck! 🚀
