import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "./firebase";
import { getMyDispatcherRole } from "./dispatcher/firestoreService";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  roleLoading: boolean;
  hasDispatcherAccess: boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [roleLoading, setRoleLoading] = useState(false);
  const [hasDispatcherAccess, setHasDispatcherAccess] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!user) {
      setHasDispatcherAccess(false);
      setRoleLoading(false);
      return;
    }

    let cancelled = false;
    setRoleLoading(true);
    void getMyDispatcherRole()
      .then((role) => {
        if (cancelled) return;
        setHasDispatcherAccess(Boolean(role && role.active !== false));
      })
      .catch(() => {
        if (cancelled) return;
        setHasDispatcherAccess(false);
      })
      .finally(() => {
        if (!cancelled) setRoleLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  const value = useMemo(
    () => ({ user, loading, roleLoading, hasDispatcherAccess }),
    [user, loading, roleLoading, hasDispatcherAccess],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
