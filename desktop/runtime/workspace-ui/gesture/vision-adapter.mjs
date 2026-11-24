// MediaPipe model and WASM are intentionally served only from the app's own authenticated loopback origin.
// No CDN requests, camera image upload, or remote model fallback.
export async function loadLocalHandLandmarker({loadModule=()=>import('./vendor/vision_bundle.mjs')}={}){
  const module=await loadModule();
  const fileset=await module.FilesetResolver.forVisionTasks('/app/gesture/vendor/wasm');
  const landmarker=await module.HandLandmarker.createFromOptions(fileset,{
    baseOptions:{modelAssetPath:'/app/gesture/vendor/models/hand_landmarker.task',delegate:'CPU'},
    runningMode:'VIDEO',numHands:2,minHandDetectionConfidence:.65,minHandPresenceConfidence:.65,minTrackingConfidence:.60,
  });
  return landmarker;
}
