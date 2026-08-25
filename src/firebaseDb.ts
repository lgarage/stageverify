import { initializeFirestore } from "firebase/firestore";
import { app } from "./firebase";
import { isIOS } from "./deviceDetect";

/** iOS Safari often hangs on Firestore WebChannel — long polling is more reliable. */
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: isIOS(),
});
