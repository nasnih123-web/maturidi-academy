/**
 * apps/mobile — src/navigation/RootNavigator.tsx
 *
 * Navigation only: auth gate + bottom tabs + per-module stacks.
 * No data fetching, no business logic — screens own their hooks (ADR-001).
 */
import React from "react";
import { Text } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { common, fontFamily, fontSize } from "@maturidi/ui-native";
import { useAuth, useEffectiveLocale } from "../hooks/useAuth";
import { t, type I18nKey } from "../i18n/strings";

import { AuthScreen } from "../screens/AuthScreen";
import { HomeScreen } from "../screens/HomeScreen";
import { QuranListScreen, SurahScreen } from "../screens/QuranScreens";
import { TasbihScreen } from "../screens/TasbihScreen";
import { AdhanScreen } from "../screens/AdhanScreen";
import { FatwaScreen } from "../screens/FatwaScreen";
import { LibraryListScreen, LibraryItemScreen } from "../screens/LibraryScreens";
import { CourseListScreen, CourseScreen, LessonScreen } from "../screens/LmsScreens";
import { SocialScreen } from "../screens/SocialScreen";
import { SettingsScreen } from "../screens/SettingsScreen";

export type RootStackParamList = {
  Auth: undefined;
  Main: undefined;
};

export type QuranStackParamList = {
  QuranHome: undefined;
  Surah: { number: number; nameAr: string };
};

export type LibraryStackParamList = {
  LibraryHome: undefined;
  Item: { itemId: string };
};

export type LmsStackParamList = {
  Courses: undefined;
  Course: { courseId: string };
  Lesson: { lessonId: string };
};

type TabKey = "Home" | "Quran" | "Tasbih" | "Adhan" | "Fatwa" | "Library" | "Lms" | "Social" | "Settings";

const TAB_META: { key: TabKey; labelKey: I18nKey; glyph: string }[] = [
  { key: "Home", labelKey: "tabs.home", glyph: "⌂" },
  { key: "Quran", labelKey: "tabs.quran", glyph: "☪" },
  { key: "Tasbih", labelKey: "tabs.tasbih", glyph: "❖" },
  { key: "Adhan", labelKey: "tabs.adhan", glyph: "◷" },
  { key: "Fatwa", labelKey: "tabs.fatwa", glyph: "❝" },
  { key: "Library", labelKey: "tabs.library", glyph: "▤" },
  { key: "Lms", labelKey: "tabs.lms", glyph: "✎" },
  { key: "Social", labelKey: "tabs.social", glyph: "☺" },
  { key: "Settings", labelKey: "tabs.settings", glyph: "⚙" },
];

const RootStack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator();
const QuranStack = createNativeStackNavigator<QuranStackParamList>();
const LibraryStack = createNativeStackNavigator<LibraryStackParamList>();
const LmsStack = createNativeStackNavigator<LmsStackParamList>();

function QuranNavigator(): React.JSX.Element {
  return (
    <QuranStack.Navigator screenOptions={{ headerShown: false }}>
      <QuranStack.Screen name="QuranHome" component={QuranListScreen} />
      <QuranStack.Screen name="Surah" component={SurahScreen} />
    </QuranStack.Navigator>
  );
}

function LibraryNavigator(): React.JSX.Element {
  return (
    <LibraryStack.Navigator screenOptions={{ headerShown: false }}>
      <LibraryStack.Screen name="LibraryHome" component={LibraryListScreen} />
      <LibraryStack.Screen name="Item" component={LibraryItemScreen} />
    </LibraryStack.Navigator>
  );
}

function LmsNavigator(): React.JSX.Element {
  return (
    <LmsStack.Navigator screenOptions={{ headerShown: false }}>
      <LmsStack.Screen name="Courses" component={CourseListScreen} />
      <LmsStack.Screen name="Course" component={CourseScreen} />
      <LmsStack.Screen name="Lesson" component={LessonScreen} />
    </LmsStack.Navigator>
  );
}

const TAB_COMPONENTS: Record<TabKey, React.ComponentType> = {
  Home: HomeScreen,
  Quran: QuranNavigator,
  Tasbih: TasbihScreen,
  Adhan: AdhanScreen,
  Fatwa: FatwaScreen,
  Library: LibraryNavigator,
  Lms: LmsNavigator,
  Social: SocialScreen,
  Settings: SettingsScreen,
};

function MainTabs(): React.JSX.Element {
  const locale = useEffectiveLocale();
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: common.primary,
        tabBarInactiveTintColor: "#64748b",
        tabBarLabelStyle: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.xs },
        tabBarStyle: { paddingBottom: 6, paddingTop: 6, height: 64 },
      }}
    >
      {TAB_META.map((meta) => (
        <Tab.Screen
          key={meta.key}
          name={meta.key}
          component={TAB_COMPONENTS[meta.key]}
          options={{
            title: t(meta.labelKey, locale),
            tabBarIcon: ({ color }) => (
              <Text style={{ color, fontSize: 22 }} accessibilityIgnoresInvertColors>
                {meta.glyph}
              </Text>
            ),
          }}
        />
      ))}
    </Tab.Navigator>
  );
}

export function RootNavigator(): React.JSX.Element {
  const { status } = useAuth();
  return (
    <NavigationContainer>
      <RootStack.Navigator screenOptions={{ headerShown: false }}>
        {status === "signed-in" ? (
          <RootStack.Screen name="Main" component={MainTabs} />
        ) : (
          <RootStack.Screen name="Auth" component={AuthScreen} />
        )}
      </RootStack.Navigator>
    </NavigationContainer>
  );
}
