/**
 * Demo fixtures for the Phase 10 social web track (lib/social.ts).
 *
 * ONLY used when NEXT_PUBLIC_SOCIAL_DEMO=1 — screenshot / manual smoke
 * testing without a live backend. Explicitly labeled demo data; never
 * part of the production path (engineering contract §15.9).
 *
 * The fixture set emulates the Track 1 contract shapes so the UI code
 * paths (pagination, banned-word 422, already-answered suggestion) are
 * exercised exactly as the real backend would drive them.
 */

import {
  CONTENT_POLICY_VIOLATION,
  SocialApiError,
  type AskQuestionInput,
  type AskQuestionResult,
  type CreatePostInput,
  type CursorPage,
  type FatwaSubmissionInput,
  type FatwaSubmissionResult,
  type PostDetail,
  type ReportInput,
  type ReportResult,
  type SocialComment,
  type SocialGroup,
  type SocialPost,
} from './social';
import type { CmsPage } from './types';

/* ------------------------------------------------------------------ */
/* Mutable demo store (session-scoped, browser only)                    */
/* ------------------------------------------------------------------ */

const GROUPS: SocialGroup[] = [
  {
    id: 'g-fiqh',
    name: 'فقه حنفی',
    description: 'گفتگو دربارهٔ مسائل فقهی مذهب حنفی و پاسخ‌گویی طلاب',
    member_count: 1284,
    joined: true,
  },
  {
    id: 'g-aqida',
    name: 'عقاید ماتریدی',
    description: 'مباحث کلامی و عقاید اهل سنت بر مبنای مکتب ماتریدی',
    member_count: 932,
    joined: false,
  },
  {
    id: 'g-quran',
    name: 'تفسیر قرآن',
    description: 'تفسیر آیات و مباحث علوم قرآنی',
    member_count: 2107,
    joined: true,
  },
];

const AUTHOR_A = { id: 'u-101', display_name: 'شیخ عبدالله رحمانی' };
const AUTHOR_B = { id: 'u-202', display_name: 'مولوی احمد نوری' };
const AUTHOR_ME = { id: 'u-me', display_name: 'کاربر مهمان' };

const POSTS: SocialPost[] = [
  {
    id: 'p-1',
    author: AUTHOR_A,
    group_id: 'g-fiqh',
    group_name: 'فقه حنفی',
    body: 'سؤالی دربارهٔ احکام وضو: آیا مسح بر جوراب نازک جایز است؟ لطفاً با ذکر دلیل از متون حنفی پاسخ دهید.',
    comments_count: 3,
    likes_count: 24,
    liked: false,
    following_author: true,
    created_at: '2026-10-19T06:12:00Z',
  },
  {
    id: 'p-2',
    author: AUTHOR_B,
    group_id: 'g-quran',
    group_name: 'تفسیر قرآن',
    body: 'در تفسیر آیهٔ «إِيَّاكَ نَعْبُدُ وَإِيَّاكَ نَسْتَعِينُ» چه نکات کلامی‌ای مورد توجه ماتریدیه است؟',
    comments_count: 1,
    likes_count: 41,
    liked: true,
    following_author: false,
    created_at: '2026-10-19T05:03:00Z',
  },
  {
    id: 'p-3',
    author: AUTHOR_A,
    group_id: 'g-aqida',
    group_name: 'عقاید ماتریدی',
    body: 'تفاوت «کسب» در مکتب ماتریدی و اشعری در مسئلهٔ افعال عباد چیست؟ منبعی معتبر معرفی کنید.',
    comments_count: 0,
    likes_count: 12,
    liked: false,
    following_author: true,
    created_at: '2026-10-18T21:40:00Z',
  },
];

const COMMENTS: Record<string, SocialComment[]> = {
  'p-1': [
    {
      id: 'c-1',
      author: AUTHOR_B,
      body: 'بنابر مشهور مذهب، مسح بر جوراب نازک جایز نیست مگر آنکه شرایط ثخین بودن را داشته باشد.',
      created_at: '2026-10-19T06:40:00Z',
    },
    {
      id: 'c-2',
      author: AUTHOR_ME,
      body: 'سپاس؛ آیا روایتی از امام ابوحنیفه در این باره نقل شده است؟',
      created_at: '2026-10-19T07:02:00Z',
    },
    {
      id: 'c-3',
      author: AUTHOR_A,
      body: 'بله، در «المبسوط» سرخسی به تفصیل بحث شده است.',
      created_at: '2026-10-19T07:20:00Z',
    },
  ],
  'p-2': [
    {
      id: 'c-4',
      author: AUTHOR_A,
      body: 'تأکید بر توحید عبادت و نفی استعانت از غیر خداوند از نکات کلیدی است.',
      created_at: '2026-10-19T05:30:00Z',
    },
  ],
};

let postSeq = 100;
let commentSeq = 100;

/** Demo emulation of the pre-publish banned-word filter (backend owns the real list). */
const DEMO_BANNED_TOKEN = 'bannedword';

function checkDemoPolicy(body: string): void {
  if (body.toLowerCase().includes(DEMO_BANNED_TOKEN)) {
    throw new SocialApiError(
      'content rejected by policy filter',
      422,
      CONTENT_POLICY_VIOLATION,
    );
  }
}

/* ------------------------------------------------------------------ */
/* Group endpoints                                                     */
/* ------------------------------------------------------------------ */

export async function demoGetGroups(_cursor?: string): Promise<CursorPage<SocialGroup>> {
  return { items: GROUPS.map((g) => ({ ...g })), next_cursor: null };
}

export async function demoJoinGroup(id: string): Promise<void> {
  const g = GROUPS.find((x) => x.id === id);
  if (!g) throw new SocialApiError('group not found', 404);
  g.joined = true;
  g.member_count += 1;
}

export async function demoLeaveGroup(id: string): Promise<void> {
  const g = GROUPS.find((x) => x.id === id);
  if (!g) throw new SocialApiError('group not found', 404);
  g.joined = false;
  g.member_count = Math.max(0, g.member_count - 1);
}

export async function demoGetGroupPosts(
  groupId: string,
  _cursor?: string,
): Promise<CursorPage<SocialPost>> {
  const items = POSTS.filter((p) => p.group_id === groupId).map((p) => ({ ...p }));
  return { items, next_cursor: null };
}

/* ------------------------------------------------------------------ */
/* Feed & posts                                                        */
/* ------------------------------------------------------------------ */

export async function demoGetFeed(_cursor?: string): Promise<CursorPage<SocialPost>> {
  return {
    items: [...POSTS].sort((a, b) => b.created_at.localeCompare(a.created_at)).map((p) => ({ ...p })),
    next_cursor: null,
  };
}

export async function demoCreatePost(input: CreatePostInput): Promise<SocialPost> {
  checkDemoPolicy(input.body);
  postSeq += 1;
  const group = input.group_id ? GROUPS.find((g) => g.id === input.group_id) : undefined;
  const post: SocialPost = {
    id: `p-${postSeq}`,
    author: AUTHOR_ME,
    group_id: input.group_id ?? null,
    group_name: group?.name ?? null,
    body: input.body,
    comments_count: 0,
    likes_count: 0,
    liked: false,
    following_author: false,
    created_at: new Date().toISOString(),
  };
  POSTS.unshift(post);
  COMMENTS[post.id] = [];
  return { ...post };
}

export async function demoGetPost(id: string): Promise<PostDetail> {
  const post = POSTS.find((p) => p.id === id);
  if (!post) throw new SocialApiError('post not found', 404);
  return {
    post: { ...post },
    comments: (COMMENTS[id] ?? []).map((c) => ({ ...c })),
  };
}

export async function demoCommentOnPost(postId: string, body: string): Promise<SocialComment> {
  checkDemoPolicy(body);
  const post = POSTS.find((p) => p.id === postId);
  if (!post) throw new SocialApiError('post not found', 404);
  commentSeq += 1;
  const comment: SocialComment = {
    id: `c-${commentSeq}`,
    author: AUTHOR_ME,
    body,
    created_at: new Date().toISOString(),
  };
  (COMMENTS[postId] ??= []).push(comment);
  post.comments_count += 1;
  return { ...comment };
}

export async function demoReportContent(_input: ReportInput): Promise<ReportResult> {
  // Demo: the backend owns the moderation queue + SLA; emulate a 201.
  return { report_id: 'r-demo-1', sla_hours: 24 };
}

export async function demoLikePost(id: string): Promise<void> {
  const p = POSTS.find((x) => x.id === id);
  if (p && !p.liked) {
    p.liked = true;
    p.likes_count = (p.likes_count ?? 0) + 1;
  }
}

export async function demoUnlikePost(id: string): Promise<void> {
  const p = POSTS.find((x) => x.id === id);
  if (p && p.liked) {
    p.liked = false;
    p.likes_count = Math.max(0, (p.likes_count ?? 1) - 1);
  }
}

export async function demoFollowAuthor(authorId: string): Promise<void> {
  for (const p of POSTS) if (p.author.id === authorId) p.following_author = true;
}

export async function demoUnfollowAuthor(authorId: string): Promise<void> {
  for (const p of POSTS) if (p.author.id === authorId) p.following_author = false;
}

/* ------------------------------------------------------------------ */
/* Fatwa question & submission                                         */
/* ------------------------------------------------------------------ */

export async function demoAskQuestion(input: AskQuestionInput): Promise<AskQuestionResult> {
  const text = input.text;
  // Demo clustering: any question about زکات hits the pre-answered cluster.
  if (text.includes('زکات') || text.includes('زكات')) {
    return {
      cluster_id: 'cluster-demo-zakat',
      suggestion: {
        answer:
          'زکات سهام بورسی بنابر نظر مشهور فقهای حنفی معاصر، در صورتی که سهام به قصد تجارت خریداری شده باشد، واجب است و به قیمت روز بازار محاسبه می‌شود؛ در غیر این صورت تنها بر سود تقسیمی زکات تعلق می‌گیرد. این پاسخ خلاصه است و جایگزین فتوای رسمی مفتی نیست.',
        answered_at: '2026-09-28T10:00:00Z',
      },
    };
  }
  return { cluster_id: `cluster-demo-${Date.now()}`, suggestion: null };
}

export async function demoSubmitFatwa(_input: FatwaSubmissionInput): Promise<FatwaSubmissionResult> {
  return { id: 'fs-demo-1', workflow_state: 'draft' };
}

/* ------------------------------------------------------------------ */
/* Guidelines CMS page fixture (slug: community-guidelines)             */
/* ------------------------------------------------------------------ */

const lt = (fa: string, ar: string, en: string) => ({ fa, ar, en });

export function demoGuidelinesPage(): CmsPage {
  return {
    slug: 'community-guidelines',
    title: lt('قوانین انجمن', 'قواعد المجتمع', 'Community Guidelines'),
    content_type: 'page',
    published_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-15T00:00:00Z',
    seo_meta: {
      title: null,
      description: 'قوانین انجمن آکادمی ماتریدی — احترام، ادب علمی و فرایند رسیدگی به گزارش‌ها',
      keywords: null,
      canonical: null,
      author: null,
    },
    blocks: [
      {
        type: 'paragraph',
        props: {
          text: lt(
            'انجمن آکادمی ماتریدی فضایی برای گفتگوی علمی طلاب و علما است. عضویت در آن به معنای پذیرش این قوانین است.',
            'مجتمع أكاديمية الماتريدي مساحة للحوار العلمي بين الطلاب والعلماء. العضوية تعني قبول هذه القواعد.',
            'The Maturidi Academy community is a space for scholarly discussion among students and scholars. Membership means accepting these rules.',
          ),
        },
      },
      { type: 'divider', props: {} },
      {
        type: 'heading',
        props: {
          level: 2,
          text: lt('۱. ادب و احترام', '١. الأدب والاحترام', '1. Courtesy and respect'),
        },
      },
      {
        type: 'paragraph',
        props: {
          text: lt(
            'از توهین، تمسخر و الفاظ رکیک خودداری کنید. نقد علمی اشکالی ندارد؛ حمله به شخص ممنوع است.',
            'تجنب الإهانة والسخرية والألفاظ البذيئة. النقد العلمي مسموح؛ الهجوم الشخصي ممنوع.',
            'Avoid insults, mockery and profanity. Scholarly criticism is welcome; personal attacks are forbidden.',
          ),
        },
      },
      {
        type: 'heading',
        props: {
          level: 2,
          text: lt('۲. امانت علمی', '٢. الأمانة العلمية', '2. Scholarly integrity'),
        },
      },
      {
        type: 'paragraph',
        props: {
          text: lt(
            'نقل قول‌ها را با ذکر منبع بنویسید. از انتشار فتوای قطعی بدون ارجاع به منبع معتبر خودداری کنید.',
            'اذكر المصدر عند الاقتباس. تجنب نشر فتوى قاطعة دون إحالة إلى مصدر موثوق.',
            'Cite your sources when quoting. Do not publish definitive fatwas without referencing a reliable source.',
          ),
        },
      },
      {
        type: 'heading',
        props: {
          level: 2,
          text: lt('۳. فیلتر خودکار و گزارش', '٣. الفلترة التلقائية والإبلاغ', '3. Automatic filtering and reports'),
        },
      },
      {
        type: 'paragraph',
        props: {
          text: lt(
            'پست‌ها و دیدگاه‌ها پیش از انتشار از فیلتر واژگان ممنوعه عبور می‌کنند. محتوای مشکل‌دار را با دکمهٔ «گزارش» اطلاع دهید؛ هر گزارش در صف نظارت با SLA مشخص (حداکثر ۲۴ ساعت) بررسی می‌شود.',
            'تخضع المنشورات والتعليقات لفلترة الكلمات المحظورة قبل النشر. أبلغ عن المحتوى المخالف بزر «إبلاغ»؛ تُراجع كل بلاغ في قائمة الإشراف خلال ٢٤ ساعة كحد أقصى.',
            'Posts and comments pass through a banned-word filter before publishing. Report problematic content with the "Report" button; every report is reviewed in the moderation queue within a 24-hour SLA.',
          ),
        },
      },
      {
        type: 'quote',
        props: {
          text: lt(
            '«الکلمة الطیبة صدقة» — سخن نیکو صدقه است.',
            '«الكلمة الطيبة صدقة»',
            '"A good word is charity."',
          ),
          author: lt('حدیث نبوی', 'حديث نبوي', 'Prophetic hadith'),
        },
      },
    ],
  };
}
