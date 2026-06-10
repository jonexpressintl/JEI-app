import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (!s) { setProfile(null); setLoading(false); }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // When a session exists, load the role from profiles
  useEffect(() => {
    if (!session) return;
    let active = true;
    supabase
      .from("profiles")
      .select("full_name, role")
      .eq("id", session.user.id)
      .single()
      .then(({ data }) => {
        if (!active) return;
        setProfile(data);
        setLoading(false);
      });
    return () => { active = false; };
  }, [session]);

  const signIn = (email, password) =>
    supabase.auth.signInWithPassword({ email, password });
  const signOut = () => supabase.auth.signOut();

  // ── Per-user second-factor passcode (verified server-side) ──
  const [passcodeCleared, setPasscodeCleared] = useState(false);

  // verify the current user's passcode
  const verifyPasscode = async (candidate) => {
    const { data, error } = await supabase.rpc("verify_my_passcode", { candidate });
    if (error) return false;
    if (data === true) setPasscodeCleared(true);
    return data === true;
  };
  // set/create the current user's passcode (first-time or change)
  const setPasscode = async (new_code) => {
    const { error } = await supabase.rpc("set_my_passcode", { new_code });
    if (!error) setPasscodeCleared(true);
    return { error };
  };
  // has this user set a passcode yet?
  const hasPasscode = async () => {
    const { data } = await supabase.rpc("my_passcode_set");
    return data === true;
  };

  // Re-lock whenever the logged-in user changes (new login must re-enter)
  useEffect(() => { setPasscodeCleared(false); }, [session?.user?.id]);

  const value = {
    session,
    profile,
    loading,
    isOwner: profile?.role === "owner",
    passcodeCleared,
    verifyPasscode,
    setPasscode,
    hasPasscode,
    signIn,
    signOut,
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
