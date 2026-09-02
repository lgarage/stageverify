import { useNavigate } from "react-router-dom";
import { auth } from "../firebase";
import { signOut } from "firebase/auth";

export function NoAccessPage() {
  const navigate = useNavigate();

  return (
    <div className="operator-no-access" data-testid="operator-no-access-page">
      <h1>Access denied</h1>
      <p>You do not have operator console access.</p>
      <button
        type="button"
        onClick={() => {
          void signOut(auth).then(() => navigate("/login", { replace: true }));
        }}
      >
        Sign out
      </button>
    </div>
  );
}
