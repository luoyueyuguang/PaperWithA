import type { PaperSummary } from "@paperwitha/domain";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { ChatScreen } from "./src/screens/ChatScreen";
import { LibraryScreen } from "./src/screens/LibraryScreen";
import { ReaderScreen } from "./src/screens/ReaderScreen";

type Route =
  | { readonly name: "library" }
  | { readonly name: "reader"; readonly paper: PaperSummary }
  | { readonly name: "chat"; readonly paper: PaperSummary; readonly backTo: "library" | "reader" };

export default function App() {
  const [route, setRoute] = useState<Route>({ name: "library" });

  return (
    <View style={styles.root}>
      {route.name === "library" ? (
        <LibraryScreen
          onOpenReader={(paper) => setRoute({ name: "reader", paper })}
          onOpenChat={(paper) => setRoute({ name: "chat", paper, backTo: "library" })}
        />
      ) : route.name === "reader" ? (
        <ReaderScreen
          paper={route.paper}
          onBack={() => setRoute({ name: "library" })}
          onOpenChat={() => setRoute({ name: "chat", paper: route.paper, backTo: "reader" })}
        />
      ) : (
        <ChatScreen
          paper={route.paper}
          onBack={() =>
            setRoute(route.backTo === "reader" ? { name: "reader", paper: route.paper } : { name: "library" })
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
});
