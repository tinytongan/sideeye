import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { supabase } from "../lib/supabase";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const signIn = async () => {
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setError("Nope. The Wombat says try again.");
    setBusy(false);
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.logo}>👀</Text>
      <Text style={styles.title}>SideEye</Text>
      <Text style={styles.sub}>Your money is being judged. Log in to watch.</Text>
      <TextInput
        style={styles.input} placeholder="Email" placeholderTextColor="#565b73"
        autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail}
      />
      <TextInput
        style={styles.input} placeholder="Password" placeholderTextColor="#565b73"
        secureTextEntry value={password} onChangeText={setPassword} onSubmitEditing={signIn}
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable style={styles.btn} onPress={signIn} disabled={busy}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Sign in</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "#14161f", alignItems: "center", justifyContent: "center", padding: 28 },
  logo: { fontSize: 56 },
  title: { color: "#fff", fontSize: 30, fontWeight: "800", marginTop: 8 },
  sub: { color: "#8b90a5", fontSize: 14, marginTop: 6, marginBottom: 28, textAlign: "center" },
  input: {
    backgroundColor: "#1c1f2e", borderRadius: 10, color: "#fff",
    paddingVertical: 12, paddingHorizontal: 14, fontSize: 15,
    width: "100%", maxWidth: 360, marginTop: 10,
  },
  error: { color: "#ff6b6b", marginTop: 12 },
  btn: {
    backgroundColor: "#7c83ff", borderRadius: 10, paddingVertical: 13,
    width: "100%", maxWidth: 360, alignItems: "center", marginTop: 18,
  },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
