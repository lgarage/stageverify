import { signOut, type Auth } from "firebase/auth";
import type { NavigateFunction } from "react-router-dom";

export function signOutWithConfirm(
  auth: Auth,
  navigate: NavigateFunction,
): void {
  if (!window.confirm("Are you sure you want to sign out?")) return;
  void signOut(auth).then(() => {
    navigate("/login", { replace: true });
  });
}
