import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useRef } from "react";
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

type Props = NativeStackScreenProps<RootStackParamList, "Welcome">;

export function WelcomeScreen({ navigation }: Props) {
  const { themeMode } = useThemePreference();
  const theme = useAppTheme(themeMode);
  const styles = createStyles(theme);
  const transitionAnim = useRef(new Animated.Value(0)).current;

  const handleNext = () => {
    Animated.timing(transitionAnim, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      navigation.navigate("ConnectionMode");
      transitionAnim.setValue(0);
    });
  };

  const headingAnimatedStyle = {
    opacity: transitionAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [1, 0.4],
    }),
    transform: [
      {
        translateY: transitionAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [0, -12],
        }),
      },
    ],
  };

  const buttonAnimatedStyle = {
    transform: [
      {
        translateX: transitionAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [0, 10],
        }),
      },
      {
        scale: transitionAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [1, 0.96],
        }),
      },
    ],
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Animated.View style={[styles.headingBlock, headingAnimatedStyle]}>
          <Text style={styles.welcomeText}>欢迎使用{"\n"}AgentLine</Text>
          <Text style={styles.subtitle}>移动端远程连接入口</Text>
        </Animated.View>

        <View style={styles.ctaWrap}>
          <Animated.View style={buttonAnimatedStyle}>
            <Pressable
              onPress={handleNext}
              style={({ pressed }) => [
                styles.nextButton,
                pressed ? styles.nextButtonPressed : null,
              ]}
            >
              <Text style={styles.nextArrow}>→</Text>
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
      paddingTop: theme.spaceMd,
      paddingBottom: theme.spaceLg,
      justifyContent: "flex-start",
      position: "relative",
    },
    headingBlock: {
      position: "absolute",
      top: "33%",
      left: theme.spaceLg,
      right: theme.spaceLg,
      gap: theme.spaceSm,
      alignItems: "flex-start",
    },
    welcomeText: {
      color: theme.text,
      fontSize: 40,
      lineHeight: 46,
      fontWeight: "800",
      textAlign: "left",
    },
    subtitle: {
      color: theme.textMuted,
      fontSize: 14,
      lineHeight: 20,
      textAlign: "left",
    },
    ctaWrap: {
      position: "absolute",
      top: "57%",
      right: theme.spaceLg,
      alignItems: "center",
      justifyContent: "center",
    },
    nextButton: {
      width: 74,
      height: 74,
      borderRadius: 37,
      backgroundColor: theme.brandTeal,
      alignItems: "center",
      justifyContent: "center",
    },
    nextButtonPressed: {
      opacity: 0.85,
      transform: [{ scale: 0.96 }],
    },
    nextArrow: {
      color: theme.isLight ? "#f8fafc" : "#f3f4f6",
      fontSize: 30,
      lineHeight: 30,
      fontWeight: "700",
      marginTop: -2,
    },
  });
