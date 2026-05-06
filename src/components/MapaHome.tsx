import AsyncStorage from "@react-native-async-storage/async-storage";
import Mapbox from "@rnmapbox/maps";
import * as Location from "expo-location";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { api } from "@/src/services/api";
import { emitirAtualizacaoGlobal, subscribeAtualizacaoGlobal } from "@/src/utils/appEvents";

const mapboxToken = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;

if (mapboxToken) {
  Mapbox.setAccessToken(mapboxToken);
}

type TipoUsuario = "DOADOR" | "COLETOR";

type Coordenada = {
  latitude: number;
  longitude: number;
};

type DoacaoMapaItem = {
  id: number;
  latitude?: number | string | null;
  longitude?: number | string | null;
  referencia?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  rua?: string | null;
  numero?: string | null;
  materiais?: string | string[] | null;
  status?: string | null;
  doadorNome?: string | null;
  doadorEmail?: string | null;
  doadorId?: number | string | null;
  coletorNome?: string | null;
  coletorEmail?: string | null;
  coletorId?: number | string | null;
  doador?: { id?: number | string | null; email?: string | null; nome?: string | null } | null;
  coletor?: { id?: number | string | null; email?: string | null; nome?: string | null } | null;
  user?: { id?: number | string | null; email?: string | null; nome?: string | null } | null;
  enderecoProtegido?: boolean;
};

type ApiResponse<T> = {
  success?: boolean;
  message?: string;
  data?: T;
};

type Props = {
  tipoUsuario?: TipoUsuario;
  onAcaoPrincipal?: () => void;
  menuOpen?: boolean;
};

const ITAREMA_CENTRO: Coordenada = {
  latitude: -2.920012,
  longitude: -39.915818,
};

function normalizarStatus(status?: string | null) {
  return String(status || "").trim().toUpperCase();
}

function coordenadaValida(latitude?: any, longitude?: any) {
  const lat = Number(latitude);
  const lng = Number(longitude);

  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    !(lat === 0 && lng === 0)
  );
}

function toCoordenada(item?: DoacaoMapaItem | null): Coordenada | null {
  if (!item || !coordenadaValida(item.latitude, item.longitude)) return null;

  return {
    latitude: Number(item.latitude),
    longitude: Number(item.longitude),
  };
}

function calcularDistanciaMetros(origem: Coordenada, destino: Coordenada) {
  const R = 6371000;
  const lat1 = (origem.latitude * Math.PI) / 180;
  const lat2 = (destino.latitude * Math.PI) / 180;
  const deltaLat = ((destino.latitude - origem.latitude) * Math.PI) / 180;
  const deltaLng = ((destino.longitude - origem.longitude) * Math.PI) / 180;

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(deltaLng / 2) *
      Math.sin(deltaLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function formatarDistancia(metros?: number | null) {
  if (!Number.isFinite(Number(metros))) return "";
  const valor = Number(metros);
  if (valor < 1000) return `${Math.round(valor)} m`;
  return `${(valor / 1000).toFixed(1).replace(".", ",")} km`;
}

function materiaisTexto(materiais?: string | string[] | null) {
  if (!materiais) return "Material não informado";
  if (Array.isArray(materiais)) return materiais.join(", ") || "Material não informado";
  return String(materiais).split(",").map((m) => m.trim()).filter(Boolean).join(", ") || "Material não informado";
}


function emailDoColetor(item: DoacaoMapaItem) {
  return String(item.coletorEmail || item.coletor?.email || "").trim().toLowerCase();
}

function idDoColetor(item: DoacaoMapaItem) {
  const id = item.coletorId ?? item.coletor?.id;
  const numero = Number(id);
  return Number.isFinite(numero) && numero > 0 ? numero : null;
}

function emailDoDoador(item: DoacaoMapaItem) {
  return String(item.doadorEmail || item.doador?.email || item.user?.email || "").trim().toLowerCase();
}

function idDoDoador(item: DoacaoMapaItem) {
  const id = item.doadorId ?? item.doador?.id ?? item.user?.id;
  const numero = Number(id);
  return Number.isFinite(numero) && numero > 0 ? numero : null;
}

function doacaoSemColetor(item: DoacaoMapaItem) {
  return !emailDoColetor(item) && !idDoColetor(item);
}

function pertenceAoColetor(item: DoacaoMapaItem, emailUsuario: string, usuarioId: number | null) {
  const email = emailDoColetor(item);
  const id = idDoColetor(item);

  if (emailUsuario && email) return email === emailUsuario;
  if (usuarioId && id) return id === usuarioId;

  return false;
}

function pertenceAoDoador(item: DoacaoMapaItem, emailUsuario: string, usuarioId: number | null) {
  const email = emailDoDoador(item);
  const id = idDoDoador(item);

  if (emailUsuario && email) return email === emailUsuario;
  if (usuarioId && id) return id === usuarioId;

  // Se o backend já retorna somente as doações do usuário e não manda dono,
  // mantemos compatibilidade para não esconder tudo sem necessidade.
  return !email && !id;
}

function doacaoVisivelParaUsuario(
  item: DoacaoMapaItem,
  tipoUsuario: TipoUsuario,
  emailUsuario: string,
  usuarioId: number | null
) {
  const status = normalizarStatus(item.status);

  if (!["PENDENTE", "ACEITA", "EM_ROTA", "AGUARDANDO_CONFIRMACAO"].includes(status)) {
    return false;
  }

  if (tipoUsuario === "COLETOR") {
    // Coletor só vê: doações livres (PENDENTE sem coletor) e as que ele mesmo aceitou.
    if (status === "PENDENTE") return doacaoSemColetor(item);
    return pertenceAoColetor(item, emailUsuario, usuarioId);
  }

  return pertenceAoDoador(item, emailUsuario, usuarioId);
}

function statusLabel(status?: string | null) {
  switch (normalizarStatus(status)) {
    case "PENDENTE":
      return "Pendente";
    case "ACEITA":
      return "Aceita";
    case "EM_ROTA":
      return "Em rota";
    case "AGUARDANDO_CONFIRMACAO":
      return "Aguardando confirmação";
    case "CONCLUIDA":
      return "Concluída";
    default:
      return "Status indefinido";
  }
}

function extrairLista(payload: any): DoacaoMapaItem[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.content)) return payload.content;
  if (Array.isArray(payload?.doacoes)) return payload.doacoes;
  return [];
}

export default function MapaHome({ tipoUsuario: tipoUsuarioProp = "DOADOR", onAcaoPrincipal }: Props) {
  const cameraRef = useRef<any>(null);
  const mountedRef = useRef(true);
  const ultimaLocalizacaoEnviadaRef = useRef<Coordenada | null>(null);
  const ultimoAutoCenterIdRef = useRef<string | number | null>(null);

  const [tipoUsuario, setTipoUsuario] = useState<TipoUsuario>(tipoUsuarioProp);
  const [emailUsuario, setEmailUsuario] = useState("");
  const [usuarioId, setUsuarioId] = useState<number | null>(null);
  const [minhaLocalizacao, setMinhaLocalizacao] = useState<Coordenada | null>(null);
  const [doacoes, setDoacoes] = useState<DoacaoMapaItem[]>([]);
  const [doacaoSelecionadaId, setDoacaoSelecionadaId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");
  const [processandoAcao, setProcessandoAcao] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setTipoUsuario(tipoUsuarioProp || "DOADOR");
  }, [tipoUsuarioProp]);

  useEffect(() => {
    async function carregarUsuario() {
      const [tipoSalvo, emailSalvo, idSalvo] = await Promise.all([
        AsyncStorage.getItem("tipoUsuario"),
        AsyncStorage.getItem("emailUsuario"),
        AsyncStorage.getItem("usuarioId"),
      ]);

      const tipo = String(tipoSalvo || tipoUsuarioProp || "DOADOR").trim().toUpperCase();
      const id = Number(idSalvo);
      setTipoUsuario(tipo === "COLETOR" ? "COLETOR" : "DOADOR");
      setEmailUsuario(String(emailSalvo || "").trim().toLowerCase());
      setUsuarioId(Number.isFinite(id) && id > 0 ? id : null);
    }

    carregarUsuario();
  }, [tipoUsuarioProp]);

  const carregarDoacoes = useCallback(async (silencioso = false) => {
    try {
      if (!silencioso) setLoading(true);
      setErro("");

      const response = await api.get<ApiResponse<DoacaoMapaItem[]>>("/doacoes");
      const lista = extrairLista(response.data?.data ?? response.data)
        .filter((item) => doacaoVisivelParaUsuario(item, tipoUsuario, emailUsuario, usuarioId))
        .filter((item) => coordenadaValida(item.latitude, item.longitude));

      if (!mountedRef.current) return;
      setDoacoes(lista);
    } catch (error: any) {
      if (!mountedRef.current) return;
      setErro(
        error?.response?.data?.message ||
          error?.response?.data?.error ||
          (error?.request ? "Sem conexão com o servidor." : "Não foi possível carregar o mapa.")
      );
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [emailUsuario, tipoUsuario, usuarioId]);

  useEffect(() => {
    carregarDoacoes();
    const interval = setInterval(() => carregarDoacoes(true), 10000);
    const unsubscribe = subscribeAtualizacaoGlobal(() => carregarDoacoes(true));

    return () => {
      clearInterval(interval);
      unsubscribe();
    };
  }, [carregarDoacoes]);

  useEffect(() => {
    let subscription: Location.LocationSubscription | null = null;

    async function iniciarLocalizacao() {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();

        if (status !== "granted") {
          setErro("Permita o acesso à localização para o mapa funcionar.");
          setLoading(false);
          return;
        }

        const atual = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        if (mountedRef.current) {
          setMinhaLocalizacao({
            latitude: atual.coords.latitude,
            longitude: atual.coords.longitude,
          });
        }

        subscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: 5000,
            distanceInterval: 5,
          },
          (posicao) => {
            if (!mountedRef.current) return;
            setMinhaLocalizacao({
              latitude: posicao.coords.latitude,
              longitude: posicao.coords.longitude,
            });
          }
        );
      } catch {
        if (mountedRef.current) {
          setErro("Não foi possível obter sua localização.");
          setLoading(false);
        }
      }
    }

    iniciarLocalizacao();

    return () => {
      if (subscription) subscription.remove();
    };
  }, []);

  const minhasColetas = useMemo(() => {
    if (tipoUsuario !== "COLETOR") return [];

    return doacoes.filter((item) => {
      const status = normalizarStatus(item.status);
      return (
        ["ACEITA", "EM_ROTA", "AGUARDANDO_CONFIRMACAO"].includes(status) &&
        pertenceAoColetor(item, emailUsuario, usuarioId)
      );
    });
  }, [doacoes, emailUsuario, tipoUsuario, usuarioId]);

  const doacaoAtiva = useMemo(() => {
    const selecionada = doacoes.find((item) => item.id === doacaoSelecionadaId);
    if (selecionada) return selecionada;

    if (tipoUsuario === "COLETOR") {
      return (
        minhasColetas.find((item) => normalizarStatus(item.status) === "EM_ROTA") ||
        minhasColetas.find((item) => normalizarStatus(item.status) === "ACEITA") ||
        minhasColetas[0] ||
        doacoes.find((item) => normalizarStatus(item.status) === "PENDENTE") ||
        null
      );
    }

    return (
      doacoes.find((item) => normalizarStatus(item.status) === "EM_ROTA") ||
      doacoes.find((item) => normalizarStatus(item.status) === "ACEITA") ||
      doacoes.find((item) => normalizarStatus(item.status) === "AGUARDANDO_CONFIRMACAO") ||
      doacoes[0] ||
      null
    );
  }, [doacaoSelecionadaId, doacoes, minhasColetas, tipoUsuario]);

  const destino = useMemo(() => toCoordenada(doacaoAtiva), [doacaoAtiva]);

  const distanciaAteDestino = useMemo(() => {
    if (!minhaLocalizacao || !destino) return null;
    return calcularDistanciaMetros(minhaLocalizacao, destino);
  }, [destino, minhaLocalizacao]);

  useEffect(() => {
    async function enviarLocalizacaoColetor() {
      if (tipoUsuario !== "COLETOR" || !minhaLocalizacao || !doacaoAtiva) return;

      const status = normalizarStatus(doacaoAtiva.status);
      if (!["ACEITA", "EM_ROTA", "AGUARDANDO_CONFIRMACAO"].includes(status)) return;

      const ultima = ultimaLocalizacaoEnviadaRef.current;
      if (ultima && calcularDistanciaMetros(ultima, minhaLocalizacao) < 8) return;

      try {
        await api.post(`/rastreamento/${doacaoAtiva.id}/coletor`, {
          latitude: minhaLocalizacao.latitude,
          longitude: minhaLocalizacao.longitude,
        });
        ultimaLocalizacaoEnviadaRef.current = minhaLocalizacao;
      } catch {
        // O mapa continua funcionando mesmo se o envio de rastreamento falhar.
      }
    }

    enviarLocalizacaoColetor();
  }, [doacaoAtiva, minhaLocalizacao, tipoUsuario]);

  const pointsFeature = useMemo(() => {
    const features = doacoes.map((item) => ({
      type: "Feature" as const,
      id: String(item.id),
      geometry: {
        type: "Point" as const,
        coordinates: [Number(item.longitude), Number(item.latitude)],
      },
      properties: {
        id: item.id,
        selecionada: item.id === doacaoAtiva?.id,
        status: normalizarStatus(item.status),
      },
    }));

    if (minhaLocalizacao) {
      features.push({
        type: "Feature" as const,
        id: "minha-localizacao",
        geometry: {
          type: "Point" as const,
          coordinates: [minhaLocalizacao.longitude, minhaLocalizacao.latitude],
        },
        properties: {
          id: -1,
          selecionada: false,
          status: "MINHA_LOCALIZACAO",
        },
      });
    }

    return {
      type: "FeatureCollection" as const,
      features,
    };
  }, [doacaoAtiva?.id, doacoes, minhaLocalizacao]);

  const linhaFeature = useMemo(() => {
    if (!minhaLocalizacao || !destino) return null;

    return {
      type: "FeatureCollection" as const,
      features: [
        {
          type: "Feature" as const,
          geometry: {
            type: "LineString" as const,
            coordinates: [
              [minhaLocalizacao.longitude, minhaLocalizacao.latitude],
              [destino.longitude, destino.latitude],
            ],
          },
          properties: {},
        },
      ],
    };
  }, [destino, minhaLocalizacao]);

  const centralizarMapa = useCallback(() => {
    if (!cameraRef.current) return;

    if (minhaLocalizacao && destino) {
      cameraRef.current.fitBounds(
        [minhaLocalizacao.longitude, minhaLocalizacao.latitude],
        [destino.longitude, destino.latitude],
        [80, 60, 260, 60],
        700
      );
      return;
    }

    const centro = minhaLocalizacao || destino || ITAREMA_CENTRO;
    cameraRef.current.setCamera({
      centerCoordinate: [centro.longitude, centro.latitude],
      zoomLevel: 14,
      animationDuration: 700,
    });
  }, [destino, minhaLocalizacao]);

  useEffect(() => {
    if (loading) return;

    const chave = doacaoAtiva?.id ?? "sem-doacao";
    if (ultimoAutoCenterIdRef.current === chave) return;

    ultimoAutoCenterIdRef.current = chave;
    const timeout = setTimeout(centralizarMapa, 400);
    return () => clearTimeout(timeout);
  }, [centralizarMapa, loading, doacaoAtiva?.id]);


  async function confirmarColetaDoDoador() {
    if (!doacaoAtiva?.id || processandoAcao) return;

    try {
      setProcessandoAcao(true);
      await api.patch(`/doacoes/${doacaoAtiva.id}/confirmar-coleta`);

      setDoacoes((listaAtual) =>
        listaAtual.filter((item) => item.id !== doacaoAtiva.id)
      );
      setDoacaoSelecionadaId(null);
      emitirAtualizacaoGlobal();
      Alert.alert("Coleta confirmada", "Obrigado por confirmar a coleta.");
    } catch (error: any) {
      Alert.alert(
        "Erro",
        error?.response?.data?.message ||
          error?.response?.data?.error ||
          "Não foi possível confirmar a coleta."
      );
    } finally {
      setProcessandoAcao(false);
    }
  }

  function handlePressDoacao(event: any) {
    const feature = event?.features?.[0];
    const id = Number(feature?.properties?.id);
    if (Number.isFinite(id) && id > 0) {
      setDoacaoSelecionadaId(id);
    }
  }

  const tituloBotao = tipoUsuario === "COLETOR" ? "Ver coletas" : "Fazer doação";
  const textoLocalizacao = minhaLocalizacao
    ? "Sua localização está ativa"
    : "Buscando sua localização...";

  if (!mapboxToken) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorTitle}>Mapa sem token</Text>
        <Text style={styles.errorText}>
          Configure EXPO_PUBLIC_MAPBOX_TOKEN no ambiente do app.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Mapbox.MapView style={styles.map} styleURL={Mapbox.StyleURL.Street}>
        <Mapbox.Camera
          ref={cameraRef}
          zoomLevel={13}
          centerCoordinate={[
            (minhaLocalizacao || destino || ITAREMA_CENTRO).longitude,
            (minhaLocalizacao || destino || ITAREMA_CENTRO).latitude,
          ]}
        />

        {linhaFeature && (
          <Mapbox.ShapeSource id="linha-rota" shape={linhaFeature as any}>
            <Mapbox.LineLayer
              id="linha-rota-layer"
              style={{
                lineColor: "#2563eb",
                lineWidth: 5,
                lineOpacity: 0.85,
                lineCap: "round",
                lineJoin: "round",
              }}
            />
          </Mapbox.ShapeSource>
        )}

        <Mapbox.ShapeSource id="pontos-doacoes" shape={pointsFeature as any} onPress={handlePressDoacao}>
          <Mapbox.CircleLayer
            id="pontos-doacoes-layer"
            style={{
              circleRadius: [
                "case",
                ["==", ["get", "status"], "MINHA_LOCALIZACAO"],
                8,
                ["==", ["get", "selecionada"], true],
                10,
                7,
              ],
              circleColor: [
                "case",
                ["==", ["get", "status"], "MINHA_LOCALIZACAO"],
                "#2563eb",
                ["==", ["get", "status"], "PENDENTE"],
                "#f59e0b",
                ["==", ["get", "status"], "EM_ROTA"],
                "#0ea5e9",
                "#22c55e",
              ],
              circleStrokeWidth: 3,
              circleStrokeColor: "#ffffff",
            }}
          />
        </Mapbox.ShapeSource>
      </Mapbox.MapView>

      <View style={styles.topCard}>
        <Text style={styles.topTitle}>Mapa Recicle+</Text>
        <Text style={styles.topText}>{textoLocalizacao}</Text>
        {!!erro && <Text style={styles.errorInline}>{erro}</Text>}
      </View>

      <View style={styles.infoCard}>
        {loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color="#16a34a" />
            <Text style={styles.infoText}>Carregando doações...</Text>
          </View>
        ) : doacaoAtiva ? (
          <>
            <Text style={styles.infoTitle}>{materiaisTexto(doacaoAtiva.materiais)}</Text>
            <Text style={styles.infoText}>Status: {statusLabel(doacaoAtiva.status)}</Text>
            <Text style={styles.infoText}>
              Local: {[doacaoAtiva.rua, doacaoAtiva.numero, doacaoAtiva.bairro, doacaoAtiva.cidade]
                .filter(Boolean)
                .join(", ") || "Localização marcada no mapa"}
            </Text>
            {distanciaAteDestino !== null && (
              <Text style={styles.infoText}>Distância aproximada: {formatarDistancia(distanciaAteDestino)}</Text>
            )}
            <Text style={styles.hintText}>
              Toque em outro ponto do mapa para selecionar outra doação.
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.infoTitle}>Nenhuma doação ativa no mapa</Text>
            <Text style={styles.infoText}>
              Quando houver doações com localização, elas aparecerão aqui.
            </Text>
          </>
        )}

        {tipoUsuario === "DOADOR" &&
          normalizarStatus(doacaoAtiva?.status) === "AGUARDANDO_CONFIRMACAO" && (
            <TouchableOpacity
              style={[styles.confirmButton, processandoAcao && styles.disabledButton]}
              onPress={confirmarColetaDoDoador}
              disabled={processandoAcao}
              activeOpacity={0.85}
            >
              <Text style={styles.confirmButtonText}>
                {processandoAcao ? "Confirmando..." : "Confirmar coleta realizada"}
              </Text>
            </TouchableOpacity>
          )}

        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.secondaryButton} onPress={centralizarMapa} activeOpacity={0.85}>
            <Text style={styles.secondaryButtonText}>Centralizar</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.mainButton}
            onPress={() => (onAcaoPrincipal ? onAcaoPrincipal() : router.push(tipoUsuario === "COLETOR" ? "/coletas" : "/doacao"))}
            activeOpacity={0.85}
          >
            <Text style={styles.mainButtonText}>{tituloBotao}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#e5e7eb",
  },
  map: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#f8fafc",
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#991b1b",
    marginBottom: 8,
  },
  errorText: {
    fontSize: 14,
    color: "#374151",
    textAlign: "center",
  },
  topCard: {
    position: "absolute",
    top: 14,
    left: 14,
    right: 14,
    backgroundColor: "rgba(255,255,255,0.96)",
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  topTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: "#111827",
  },
  topText: {
    marginTop: 2,
    color: "#4b5563",
    fontSize: 13,
  },
  errorInline: {
    marginTop: 6,
    color: "#dc2626",
    fontSize: 12,
    fontWeight: "700",
  },
  infoCard: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 18,
    backgroundColor: "#fff",
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 4,
  },
  infoText: {
    color: "#374151",
    fontSize: 13,
    marginTop: 3,
    lineHeight: 18,
  },
  hintText: {
    color: "#6b7280",
    fontSize: 12,
    marginTop: 8,
  },
  confirmButton: {
    marginTop: 12,
    minHeight: 46,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#7c3aed",
  },
  confirmButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "900",
  },
  disabledButton: {
    opacity: 0.65,
  },
  buttonRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
  },
  secondaryButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#e0f2fe",
  },
  secondaryButtonText: {
    color: "#0369a1",
    fontSize: 14,
    fontWeight: "800",
  },
  mainButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#16a34a",
  },
  mainButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "900",
  },
});
