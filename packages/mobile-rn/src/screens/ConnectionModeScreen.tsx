import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { RootStackParamList } from "../navigation/types";
import { useThemePreference } from "../styles/ThemePreferenceContext";
import type { AppTheme } from "../styles/theme";
import { useAppTheme } from "../styles/theme";

type Props = NativeStackScreenProps<RootStackParamList, "ConnectionMode">;

export function ConnectionModeScreen({ navigation }: Props) {
  const { themeMode } = useThemePreference();
  const theme = useAppTheme(themeMode);
  const styles = createStyles(theme);
  const firstCardAnim = useRef(new Animated.Value(0)).current;
  const secondCardAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.stagger(90, [
      Animated.timing(firstCardAnim, {
        toValue: 1,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(secondCardAnim, {
        toValue: 1,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [firstCardAnim, secondCardAnim]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.patternBlobTop} />
        <View style={styles.patternBlobBottom} />
        <Text style={styles.title}>选择连接方式</Text>
        <View style={styles.modeList}>
          <Animated.View
            style={[
              styles.modeCardAnimated,
              {
                opacity: firstCardAnim,
                transform: [
                  {
                    translateY: firstCardAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [20, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            <Pressable
              onPress={() => navigation.push("Login", { mode: "relay" })}
              style={({ pressed }) => [
                styles.modeCard,
                styles.modeCardPrimary,
                pressed ? styles.modeCardPressed : null,
              ]}
            >
              <Text style={styles.modeCardTitle}>平台账号登录</Text>
            </Pressable>
          </Animated.View>
          <Animated.View
            style={[
              styles.modeCardAnimated,
              {
                opacity: secondCardAnim,
                transform: [
                  {
                    translateY: secondCardAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [20, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            <Pressable
              onPress={() => navigation.push("Login", { mode: "direct" })}
              style={({ pressed }) => [
                styles.modeCard,
                pressed ? styles.modeCardPressed : null,
              ]}
            >
              <Text style={styles.modeCardTitle}>局域网直连</Text>
            </Pressable>
          </Animated.View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: theme.bg,
    },
    container: {
      flex: 1,
      paddingHorizontal: theme.spaceLg,
      justifyContent: "center",
      gap: theme.spaceMd,
    },
    title: {
      color: theme.text,
      fontSize: 22,
      lineHeight: 28,
      fontWeight: "800",
      textAlign: "center",
    },
    patternBlobTop: {
      position: "absolute",
      width: 220,
      height: 220,
      borderRadius: 999,
      backgroundColor: "rgba(22, 163, 116, 0.08)",
      top: "22%",
      left: -80,
    },
    patternBlobBottom: {
      position: "absolute",
      width: 240,
      height: 240,
      borderRadius: 999,
      backgroundColor: "rgba(22, 163, 116, 0.05)",
      bottom: "18%",
      right: -100,
    },
    modeList: {
      gap: theme.spaceMd,
      alignItems: "center",
    },
    modeCardAnimated: {
      width: "100%",
      maxWidth: 360,
    },
    modeCard: {
      minHeight: 122,
      borderRadius: 40,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.panel,
      alignItems: "center",
      justifyContent: "center",
    },
    modeCardPrimary: {
      borderColor: theme.brandTeal,
      backgroundColor: theme.panelAlt,
    },
    modeCardPressed: {
      opacity: 0.88,
      transform: [{ scale: 0.985 }],
    },
    modeCardTitle: {
      color: theme.text,
      fontSize: 20,
      fontWeight: "700",
      textAlign: "center",
    },
  });
