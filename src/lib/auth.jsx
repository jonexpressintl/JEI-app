import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "./supabase";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession]       = useState(undefined); // undefined = loading
  const [profile, setProfile]       = useState(null);
  const [passcodeCleared, setPasscodeCleared] = useState(false);

  useEffect(() => {
    // Get current session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session ?? null);
      if (session) loadProfile(session.user.id);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session ?? null);
      if (!session) { setProfile(null); setPasscodeCleared(false); }
      else loadProfile(session.user.id);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function loadProfile(userId) {
    const { data } = await supabase
      .from("profiles")
      .select("full_name, role, pass_hash")
      .eq("id", userId)
      .single();
    setProfile(data ?? null);
  }

  async function signIn(email, password) {
    const result = await supabase.auth.signInWithPassword({ email, password });
    return result;
  }

  async function signOut() {
    setPasscodeCleared(false);
    await supabase.auth.signOut();
  }

  // Check whether this user has already set a passcode (pass_hash not null)
  async function hasPasscode() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    const { data } = await supabase
      .from("profiles")
      .select("pass_hash")
      .eq("id", user.id)
      .single();
    return !!data?.pass_hash;
  }

  // Verify entered passcode against stored bcrypt hash via RPC
  async function verifyPasscode(code) {
    const { data } = await supabase.rpc("verify_my_passcode", { passcode: code });
    if (data === true) setPasscodeCleared(true);
    return data === true;
  }

  // Set a new passcode for the current user via RPC
  async function setPasscode(code) {
    const result = await supabase.rpc("set_my_passcode", { passcode: code });
    if (!result.error) setPasscodeCleared(true);
    return result;
  }

  const isOwner = profile?.role === "owner";
  const loading = session === undefined;

  return (
    <AuthContext.Provider value={{
      session, profile, isOwner, loading,
      passcodeCleared, signIn, signOut,
      hasPasscode, verifyPasscode, setPasscode,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
