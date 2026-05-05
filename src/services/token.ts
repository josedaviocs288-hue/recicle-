import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

const TOKEN_KEY = "@recicleplus_token";
const LEGACY_TOKEN_KEY = "token";

const USER_TYPE_KEY = "@recicleplus_user_type";

// ================= TOKEN =================

export async function setToken(token: string): Promise<void> {
  const valor = String(token || "").trim();

  if (!valor) return;

  // Salva o token no armazenamento seguro do aparelho
  await SecureStore.setItemAsync(TOKEN_KEY, valor);

  // Remove cópias antigas/inseguras do AsyncStorage
  await AsyncStorage.multiRemove([TOKEN_KEY, LEGACY_TOKEN_KEY]);
}

export async function getToken(): Promise<string | null> {
  const secureToken = await SecureStore.getItemAsync(TOKEN_KEY);

  if (secureToken && secureToken.trim() !== "") {
    return secureToken;
  }

  // Migração automática: se ainda existir token antigo no AsyncStorage,
  // move para o SecureStore e apaga do AsyncStorage.
  const legacyToken =
    (await AsyncStorage.getItem(TOKEN_KEY)) ||
    (await AsyncStorage.getItem(LEGACY_TOKEN_KEY));

  if (!legacyToken || legacyToken.trim() === "") {
    return null;
  }

  const valor = legacyToken.trim();

  await SecureStore.setItemAsync(TOKEN_KEY, valor);
  await AsyncStorage.multiRemove([TOKEN_KEY, LEGACY_TOKEN_KEY]);

  return valor;
}

export async function removeToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  await AsyncStorage.multiRemove([TOKEN_KEY, LEGACY_TOKEN_KEY]);
}

// ================= TIPO USUÁRIO =================

export async function setUserType(tipo: string): Promise<void> {
  const valor = String(tipo || "").trim().toUpperCase();

  if (!valor) return;

  // Tipo de usuário não é tão sensível quanto o token,
  // pode continuar no AsyncStorage para manter compatibilidade com o app.
  await AsyncStorage.multiSet([
    [USER_TYPE_KEY, valor],
    ["tipoUsuario", valor],
    ["tipo", valor],
    ["@tipoUsuario", valor],
  ]);
}

export async function getUserType(): Promise<string | null> {
  const tipo =
    (await AsyncStorage.getItem(USER_TYPE_KEY)) ||
    (await AsyncStorage.getItem("tipoUsuario")) ||
    (await AsyncStorage.getItem("tipo")) ||
    (await AsyncStorage.getItem("@tipoUsuario"));

  if (!tipo || tipo.trim() === "") return null;

  return tipo;
}

export async function removeUserType(): Promise<void> {
  await AsyncStorage.multiRemove([
    USER_TYPE_KEY,
    "tipoUsuario",
    "tipo",
    "@tipoUsuario",
  ]);
}

export async function clearAuthStorage(): Promise<void> {
  await removeToken();
  await removeUserType();
}