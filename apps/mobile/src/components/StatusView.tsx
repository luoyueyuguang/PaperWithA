import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

export type StatusKind = "loading" | "empty" | "error";

export interface StatusViewProps {
  readonly kind: StatusKind;
  readonly title: string;
  readonly detail?: string;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
}

export function StatusView({ kind, title, detail, actionLabel, onAction }: StatusViewProps) {
  return (
    <View style={styles.container}>
      {kind === "loading" ? <ActivityIndicator color="#2563eb" /> : null}
      <Text style={[styles.title, kind === "error" && styles.errorTitle]}>{title}</Text>
      {detail !== undefined && detail.length > 0 ? <Text style={styles.detail}>{detail}</Text> : null}
      {actionLabel !== undefined && onAction !== undefined ? (
        <Pressable style={styles.button} onPress={onAction}>
          <Text style={styles.buttonText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
    textAlign: "center",
  },
  errorTitle: {
    color: "#b91c1c",
  },
  detail: {
    fontSize: 13,
    lineHeight: 20,
    color: "#6b7280",
    textAlign: "center",
  },
  button: {
    marginTop: 4,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: "#2563eb",
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "600",
  },
});
