/**
 * apps/mobile — src/screens/LmsScreens.tsx
 *
 * LMS: course list → course detail (lessons) → lesson reader.
 */
import React from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  Badge,
  Button,
  Card,
  CardTitle,
  common,
  EmptyState,
  fontFamily,
  fontSize,
  ProgressBar,
  Screen,
  spacing,
  statusTone,
} from "@maturidi/ui-native";
import { useCourseDetail, useCourses, useLesson } from "../hooks/useLms";
import { useEffectiveLocale } from "../hooks/useAuth";
import { t } from "../i18n/strings";
import { resolveText } from "../types";
import type { LmsStackParamList } from "../navigation/RootNavigator";

type CoursesProps = NativeStackScreenProps<LmsStackParamList, "Courses">;
type CourseProps = NativeStackScreenProps<LmsStackParamList, "Course">;
type LessonProps = NativeStackScreenProps<LmsStackParamList, "Lesson">;

export function CourseListScreen({ navigation }: CoursesProps): React.JSX.Element {
  const locale = useEffectiveLocale();
  const { courses, loading, error, refresh } = useCourses();

  return (
    <Screen
      title={t("lms.title", locale)}
      subtitle={t("lms.subtitle", locale)}
      refreshing={loading}
      onRefresh={refresh}
    >
      {loading && courses.length === 0 ? (
        <ActivityIndicator size="large" color={common.primary} />
      ) : error ? (
        <EmptyState title={t("common.errorTitle", locale)} message={error} actionTitle={t("common.retry", locale)} onAction={refresh} />
      ) : (
        <FlatList
          data={courses}
          keyExtractor={(c) => c.id}
          scrollEnabled={false}
          ListEmptyComponent={<EmptyState title={t("common.emptyTitle", locale)} />}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => navigation.navigate("Course", { courseId: item.id })}
              accessibilityRole="button"
            >
              <Card style={styles.row}>
                <View style={styles.meta}>
                  <Text style={styles.title} numberOfLines={2}>
                    {resolveText(item.title, locale)}
                  </Text>
                  <Text style={styles.muted}>
                    {item.lesson_count} {t("lms.lessons", locale)} • {item.level}
                  </Text>
                  {item.progress_pct != null ? <ProgressBar value={item.progress_pct / 100} /> : null}
                </View>
              </Card>
            </TouchableOpacity>
          )}
          ItemSeparatorComponent={() => <View style={{ height: spacing[2] }} />}
        />
      )}
    </Screen>
  );
}

export function CourseScreen({ route, navigation }: CourseProps): React.JSX.Element {
  const locale = useEffectiveLocale();
  const { courseId } = route.params;
  const { course, loading, error } = useCourseDetail(courseId);

  return (
    <Screen title={course ? resolveText(course.title, locale) : t("lms.title", locale)}>
      <Button title={t("common.back", locale)} variant="ghost" size="sm" onPress={() => navigation.goBack()} />
      {loading ? (
        <ActivityIndicator size="large" color={common.primary} />
      ) : error || !course ? (
        <EmptyState title={t("common.errorTitle", locale)} message={error ?? undefined} />
      ) : (
        <>
          {course.description ? <Text style={styles.desc}>{resolveText(course.description, locale)}</Text> : null}
          {(course.lessons ?? []).map((lesson, i) => (
            <TouchableOpacity
              key={lesson.id}
              onPress={() => navigation.navigate("Lesson", { lessonId: lesson.id })}
              accessibilityRole="button"
            >
              <Card style={styles.row}>
                <Badge label={String(i + 1)} tone="neutral" />
                <View style={styles.meta}>
                  <Text style={styles.title} numberOfLines={2}>
                    {resolveText(lesson.title, locale)}
                  </Text>
                  <View style={styles.lessonMeta}>
                    <Text style={styles.muted}>
                      {lesson.duration_minutes} {t("lms.minutes", locale)}
                    </Text>
                    {lesson.status ? (
                      <Badge
                        label={t(
                          lesson.status === "completed"
                            ? "lms.completed"
                            : lesson.status === "in_progress"
                              ? "lms.inProgress"
                              : "lms.notStarted",
                          locale,
                        )}
                        tone={statusTone(lesson.status)}
                      />
                    ) : null}
                  </View>
                </View>
              </Card>
            </TouchableOpacity>
          ))}
        </>
      )}
    </Screen>
  );
}

function LessonBody({ body }: { body: unknown[] }): React.JSX.Element {
  return (
    <View style={styles.bodyWrap}>
      {body.map((block, i) => {
        if (typeof block === "string") {
          return (
            <Text key={i} style={styles.bodyText}>
              {block}
            </Text>
          );
        }
        if (block && typeof block === "object") {
          const b = block as Record<string, unknown>;
          const text = typeof b.text === "string" ? b.text : typeof b.content === "string" ? b.content : null;
          if (text) {
            return (
              <Text key={i} style={b.type === "heading" || b.kind === "heading" ? styles.bodyHeading : styles.bodyText}>
                {text}
              </Text>
            );
          }
        }
        return null;
      })}
    </View>
  );
}

export function LessonScreen({ route, navigation }: LessonProps): React.JSX.Element {
  const locale = useEffectiveLocale();
  const { lessonId } = route.params;
  const { lesson, loading, error, saving, offline, saveProgress } = useLesson(lessonId);

  return (
    <Screen title={lesson ? resolveText(lesson.title, locale) : t("lms.title", locale)}>
      <Button title={t("common.back", locale)} variant="ghost" size="sm" onPress={() => navigation.goBack()} />
      {loading ? (
        <ActivityIndicator size="large" color={common.primary} />
      ) : error || !lesson ? (
        <EmptyState title={t("common.errorTitle", locale)} message={error ?? undefined} />
      ) : (
        <Card>
          <CardTitle>{resolveText(lesson.title, locale)}</CardTitle>
          <LessonBody body={lesson.body ?? []} />
          <View style={styles.navRow}>
            {lesson.prev_lesson_id ? (
              <Button
                title={t("lms.prevLesson", locale)}
                variant="secondary"
                size="sm"
                onPress={() => navigation.replace("Lesson", { lessonId: lesson.prev_lesson_id as string })}
              />
            ) : (
              <View />
            )}
            {lesson.next_lesson_id ? (
              <Button
                title={t("lms.nextLesson", locale)}
                variant="secondary"
                size="sm"
                onPress={() => navigation.replace("Lesson", { lessonId: lesson.next_lesson_id as string })}
              />
            ) : (
              <View />
            )}
          </View>
          <Button
            title={lesson.status === "completed" ? t("lms.completed", locale) : t("lms.markComplete", locale)}
            onPress={() => saveProgress("completed")}
            loading={saving}
            disabled={lesson.status === "completed"}
          />
          {offline ? <Badge label={t("common.offline", locale)} tone="warning" /> : null}
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: spacing[3], alignItems: "center" },
  meta: { flex: 1, gap: spacing[1] },
  title: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.base, color: common.textPrimary, textAlign: "right" },
  muted: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.sm, color: common.textMuted },
  desc: {
    fontFamily: fontFamily.bodyFa,
    fontSize: fontSize.base,
    color: common.textMuted,
    textAlign: "right",
    lineHeight: 26,
  },
  lessonMeta: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  bodyWrap: { gap: spacing[2], marginVertical: spacing[2] },
  bodyText: { fontFamily: fontFamily.bodyFa, fontSize: fontSize.base, color: common.textPrimary, textAlign: "right", lineHeight: 30 },
  bodyHeading: {
    fontFamily: fontFamily.heading,
    fontSize: fontSize.xl,
    color: common.textPrimary,
    textAlign: "right",
  },
  navRow: { flexDirection: "row", justifyContent: "space-between", marginVertical: spacing[2] },
});
