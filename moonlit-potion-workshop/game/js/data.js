/** Pure game data from SPEC.md §§8–9. */

export const MAIN_EFFECTS = Object.freeze(["calm", "wake", "heal", "shift"]);

export const SIDE_EFFECTS = Object.freeze([
  Object.freeze({ id: "oversleep", name: "深眠（起きられない）", severity: "major" }),
  Object.freeze({ id: "morning-haze", name: "朝靄の眠気", severity: "minor" }),
  Object.freeze({ id: "vivid-dreams", name: "鮮明な夢", severity: "minor" }),
  Object.freeze({ id: "jitters", name: "動悸", severity: "major" }),
  Object.freeze({ id: "glow-scar", name: "傷跡が光る", severity: "minor" }),
  Object.freeze({ id: "voice-change", name: "声変わり", severity: "major" }),
  Object.freeze({ id: "bitterness", name: "強い苦味", severity: "minor" }),
  Object.freeze({ id: "numb-tongue", name: "舌の痺れ", severity: "minor" }),
  Object.freeze({ id: "moon-mark", name: "月紋が浮かぶ", severity: "minor" }),
  Object.freeze({ id: "weeping-eyes", name: "涙が止まらない", severity: "minor" }),
  Object.freeze({ id: "heavy-limbs", name: "手足が重い", severity: "major" }),
  Object.freeze({ id: "sparks", name: "火の粉が散る", severity: "major" }),
]);

export const SIDE_EFFECT_BY_ID = Object.freeze(
  Object.fromEntries(SIDE_EFFECTS.map((sideEffect) => [sideEffect.id, sideEffect])),
);

export const MATERIALS = Object.freeze([
  Object.freeze({
    id: "moon-petal",
    name: "月光花びら",
    mainEffect: "calm",
    support: null,
    tempBand: "low",
    recommendedPrep: "cut",
    pourBand: Object.freeze({ min: 50, max: 80 }),
    tags: Object.freeze(["floral", "lunar"]),
    sideEffect: "oversleep",
  }),
  Object.freeze({
    id: "sunfeather",
    name: "陽羽根",
    mainEffect: "wake",
    support: null,
    tempBand: "high",
    recommendedPrep: "cut",
    pourBand: Object.freeze({ min: 55, max: 80 }),
    tags: Object.freeze(["solar"]),
    sideEffect: "jitters",
  }),
  Object.freeze({
    id: "silvermoss",
    name: "銀苔",
    mainEffect: "heal",
    support: null,
    tempBand: "mid",
    recommendedPrep: "crush",
    pourBand: Object.freeze({ min: 50, max: 80 }),
    tags: Object.freeze(["earth"]),
    sideEffect: "glow-scar",
  }),
  Object.freeze({
    id: "toadcap",
    name: "蛙鱗茸",
    mainEffect: "shift",
    support: null,
    tempBand: "high",
    recommendedPrep: "cut",
    pourBand: Object.freeze({ min: 55, max: 78 }),
    tags: Object.freeze(["fungal"]),
    sideEffect: "voice-change",
  }),
  Object.freeze({
    id: "mistleaf",
    name: "霧葉",
    mainEffect: null,
    support: "shorten",
    tempBand: "low",
    recommendedPrep: "none",
    pourBand: Object.freeze({ min: 45, max: 75 }),
    tags: Object.freeze(["herbal"]),
    sideEffect: "morning-haze",
  }),
  Object.freeze({
    id: "star-salt",
    name: "星塩",
    mainEffect: null,
    support: "amplify",
    tempBand: "any",
    recommendedPrep: "crush",
    pourBand: Object.freeze({ min: 60, max: 75 }),
    tags: Object.freeze(["mineral", "lunar"]),
    sideEffect: "vivid-dreams",
  }),
  Object.freeze({
    id: "dewpearl",
    name: "露珠",
    mainEffect: null,
    support: "soften",
    tempBand: "low",
    recommendedPrep: "none",
    pourBand: Object.freeze({ min: 55, max: 78 }),
    tags: Object.freeze(["water"]),
    sideEffect: "numb-tongue",
  }),
  Object.freeze({
    id: "bitterroot",
    name: "苦根",
    mainEffect: null,
    support: "stabilize",
    tempBand: "mid",
    recommendedPrep: "crush",
    pourBand: Object.freeze({ min: 45, max: 80 }),
    tags: Object.freeze(["earth", "herbal"]),
    sideEffect: "bitterness",
  }),
]);

export const MATERIAL_BY_ID = Object.freeze(
  Object.fromEntries(MATERIALS.map((material) => [material.id, material])),
);

/** The four, and only the four, tag-affinity rules in SPEC.md §8.3. */
export const TAG_AFFINITY_RULES = Object.freeze([
  Object.freeze({ id: "solar-lunar", tags: Object.freeze(["solar", "lunar"]), stability: -20 }),
  Object.freeze({ id: "lunar-lunar", tag: "lunar", minimumMaterials: 2, potency: 5 }),
  Object.freeze({ id: "water-fungal", tags: Object.freeze(["water", "fungal"]), effect: "shift", potency: 10 }),
  Object.freeze({ id: "earth-herbal", tags: Object.freeze(["earth", "herbal"]), stability: 5 }),
]);

const question = (prompt, firstLabel, firstReply, secondLabel, secondReply) => Object.freeze({
  prompt,
  choices: Object.freeze([
    Object.freeze({ label: firstLabel, reply: firstReply }),
    Object.freeze({ label: secondLabel, reply: secondReply }),
  ]),
});

const epilogues = (great, ok, fail) => Object.freeze({ great, ok, fail });

export const ORDERS = Object.freeze([
  Object.freeze({
    id: 1,
    night: 1,
    clientName: "配達人",
    quote: "眠りたい。でも夜明けには起きる。",
    required: Object.freeze({ effect: "calm", min: 60, duration: "short" }),
    forbidden: Object.freeze(["oversleep"]),
    question: question("夜明けを逃せない理由は？", "初仕事だから", "荷が届くのを待っている人がいます。", "急ぎの便だから", "遅れれば町の朝が困ります。"),
    hint: "短く穏やかな鎮静を。深すぎる眠りは避けよう。",
    hidden: Object.freeze({
      circumstance: "初仕事の緊張で三日眠れていない",
      epilogues: epilogues("夜明け前、彼は軽い足取りで最初の便へ向かった。", "眠りは浅かったが、彼は約束の時刻に起きられた。", "寝過ごした彼は、震える手で次の便を頼んだ。"),
    }),
  }),
  Object.freeze({
    id: 2,
    night: 1,
    clientName: "見習い薬師",
    quote: "師匠の傷薬を代わりに作りたい。",
    required: Object.freeze({ effect: "heal", min: 60 }),
    forbidden: Object.freeze(["glow-scar"]),
    question: question("師匠の傷はいつから？", "今夜できた傷", "今日はずっと部屋にいたはずなのに。", "前からの古傷", "痛みを隠すのが上手な人です。"),
    hint: "治癒を十分に。傷跡が光る副作用は隠し事を増やす。",
    hidden: Object.freeze({
      circumstance: "師匠は毎夜こっそり外出している",
      epilogues: epilogues("薬が効き、師匠は夜の外出を休むと約束した。", "傷は和らぎ、見習いは少しだけ安心した。", "光る傷跡に、見習いの疑念だけが残った。"),
    }),
  }),
  Object.freeze({
    id: 3,
    night: 1,
    clientName: "夜警",
    quote: "朝まで眠気を飛ばしたい。",
    required: Object.freeze({ effect: "wake", min: 60, duration: "long" }),
    forbidden: Object.freeze(["jitters"]),
    question: question("今夜の見回りは長い？", "夜明けまで", "交代の者が来られない。", "いつもより長い", "港の灯りが気になるんだ。"),
    hint: "長く続く覚醒を。心臓を急かす副作用は危険。",
    hidden: Object.freeze({
      circumstance: "心臓が弱いことを隠している",
      epilogues: epilogues("穏やかな目覚めで、彼は朝まで町を守った。", "眠気は払え、夜警は交代まで持ちこたえた。", "動悸に膝をつき、彼は隠していた弱さを認めた。"),
    }),
  }),
  Object.freeze({
    id: 4,
    night: 1,
    clientName: "眠れない子の親",
    quote: "子どもに優しい眠り薬を。",
    required: Object.freeze({ effect: "calm", min: 40, maxPotency: 70 }),
    forbidden: Object.freeze(["oversleep", "heavy-limbs"]),
    question: question("お子さんは何を怖がっていますか？", "雷の音", "窓を叩く雨に目を覚ますんです。", "暗い部屋", "灯りを消すと泣き出します。"),
    hint: "鎮静は弱すぎず、強すぎず。重い眠りも避ける。",
    hidden: Object.freeze({
      circumstance: "本当は親のほうが眠れていない",
      epilogues: epilogues("子の寝息を聞き、親も初めて椅子で眠った。", "子は落ち着き、親の肩から少し力が抜けた。", "親は子を抱いたまま、夜を明かした。"),
    }),
  }),
  Object.freeze({
    id: 5,
    night: 2,
    clientName: "役人",
    quote: "一晩だけ嘘をつけなくなりたい。",
    required: Object.freeze({ effect: "shift", min: 60, duration: "short" }),
    forbidden: Object.freeze(["voice-change"]),
    question: question("明日は誰と話しますか？", "評議会", "逃げずに皆の前で話します。", "一人の相手", "まず、その人にだけ話したい。"),
    hint: "短時間の変身を。声まで変えてしまわないように。",
    hidden: Object.freeze({
      circumstance: "明日、自分の汚職を自白するつもり",
      epilogues: epilogues("澄んだ声で、役人は自らの罪を語った。", "言葉は途切れたが、告白は始まった。", "変わった声に紛れ、彼はまた真実を飲み込んだ。"),
    }),
  }),
  Object.freeze({
    id: 6,
    night: 2,
    clientName: "水辺の精霊",
    quote: "雨の間だけ人間の姿になりたい。",
    required: Object.freeze({ effect: "shift", min: 60, duration: "short" }),
    forbidden: Object.freeze([Object.freeze({ duration: "long" })]),
    question: question("雨が止んだら、どこへ？", "水辺へ戻る", "朝までには戻らなければ。", "町へ残る", "あと少しだけ歌を聞きたい。"),
    hint: "変身は十分に、けれど長く残さない。",
    hidden: Object.freeze({
      circumstance: "人間の楽士に会いに行く",
      epilogues: epilogues("雨音の下で、精霊と楽士は一曲を分け合った。", "会う時間は短かったが、約束は残った。", "姿が長く残り、水辺は不穏に波立った。"),
    }),
  }),
  Object.freeze({
    id: 7,
    night: 2,
    clientName: "騎士",
    quote: "傷は治したい。戦いの記憶は消したくない。",
    required: Object.freeze({ effect: "heal", min: 70 }),
    forbidden: Object.freeze(["vivid-dreams"]),
    question: question("傷は急ぎますか？", "明日の任務までに", "剣を持てるようになりたい。", "時間はある", "傷と向き合う覚悟はあります。"),
    hint: "高い治癒を。鮮明すぎる夢は記憶を責め立てる。",
    hidden: Object.freeze({
      circumstance: "記憶は罪悪感であり、償いでもある",
      epilogues: epilogues("傷が閉じ、騎士は記憶を抱えたまま歩き出した。", "痛みは和らぎ、彼は静かに過去を語った。", "夢に責められ、騎士は眠れぬまま夜明けを迎えた。"),
    }),
  }),
  Object.freeze({
    id: 8,
    night: 2,
    clientName: "庭師",
    quote: "花を咲かせたい。早すぎる成長は嫌。",
    required: Object.freeze({ effect: "heal", min: 50, maxPotency: 75 }),
    forbidden: Object.freeze([Object.freeze({ duration: "long" })]),
    question: question("球根はどんな花ですか？", "白い花", "妻が最後に植えた球根です。", "まだ分からない", "咲くまで名前はつけません。"),
    hint: "治癒はほどよく。効きすぎも長すぎも避ける。",
    hidden: Object.freeze({
      circumstance: "亡き妻が植えた最後の球根",
      epilogues: epilogues("朝、庭に小さな蕾がひとつ現れた。", "土は少し柔らぎ、庭師は明日を待つことにした。", "急ぎすぎた季節が、球根を疲れさせてしまった。"),
    }),
  }),
  Object.freeze({
    id: 9,
    night: 3,
    clientName: "吟遊詩人",
    quote: "緊張は取りたいが頭は冴えたまま。",
    required: Object.freeze({ effect: "calm", min: 50 }),
    forbidden: Object.freeze(["morning-haze", "oversleep"]),
    question: question("今夜の舞台は大きい？", "満席の酒場", "見知った顔が多いんです。", "小さな舞台", "それでも、あの人が来ます。"),
    hint: "心を静めつつ、朝靄のような眠気は避けよう。",
    hidden: Object.freeze({
      circumstance: "今夜の舞台に昔の恋人が来る",
      epilogues: epilogues("歌は澄み、客席の彼女は最後まで耳を傾けた。", "震えは残ったが、詩人は歌い切った。", "眠気に言葉を失い、歌は途中でほどけた。"),
    }),
  }),
  Object.freeze({
    id: 10,
    night: 3,
    clientName: "星読み",
    quote: "鮮明な夢を見たい。",
    required: Object.freeze({ effect: "calm", min: 40, requiredSideEffect: "vivid-dreams" }),
    forbidden: Object.freeze(["jitters"]),
    question: question("夢で誰に会いたいのですか？", "昔の師に", "起きている間は、もう会えません。", "星の記録に", "昨夜の星図を確かめたい。"),
    hint: "鎮静と、意図した鮮明な夢を両立させる。動悸は避ける。",
    hidden: Object.freeze({
      circumstance: "夢の中でしか会えない師がいる",
      epilogues: epilogues("夢の師は微笑み、消えた星の名を教えた。", "夢は途切れ途切れでも、師の声は届いた。", "胸騒ぎに夢を追われ、星読みは眠れなかった。"),
    }),
  }),
  Object.freeze({
    id: 11,
    night: 3,
    clientName: "猟師",
    quote: "三日効く塗り薬を。",
    required: Object.freeze({ effect: "heal", min: 60, duration: "long" }),
    forbidden: Object.freeze(["bitterness"]),
    question: question("誰のための薬ですか？", "自分のため", "森で少し深く切ってしまって。", "獣のため", "恐がらせずに近づきたいんです。"),
    hint: "長く続く治癒を。苦味は使う相手を遠ざける。",
    hidden: Object.freeze({
      circumstance: "手負いの獣を治して逃がすため",
      epilogues: epilogues("獣は傷を癒やし、森の奥へ静かに消えた。", "薬は効き始め、猟師は距離を取って待った。", "苦味に獣が暴れ、森へ逃げ込んでしまった。"),
    }),
  }),
  Object.freeze({
    id: 12,
    night: 3,
    clientName: "月の使い",
    quote: "満月の儀へ、月光の調和を一瓶。",
    required: Object.freeze({ effect: "calm", min: 70, stabilityMin: 85 }),
    forbidden: Object.freeze(SIDE_EFFECTS.map((sideEffect) => sideEffect.id)),
    question: question("儀はいつ始まりますか？", "満月が頂く時", "月の影が消える前です。", "夜明け前", "最後の鐘に合わせます。"),
    hint: "高い鎮静と安定を、いかなる副作用もなく。",
    hidden: Object.freeze({
      circumstance: "工房の腕を月が試している",
      epilogues: epilogues("月光は瓶の中で澄み、儀は静かに結ばれた。", "儀は保たれ、月の使いは小さく頷いた。", "月光は濁り、使いは何も告げずに去った。"),
    }),
  }),
]);

export const ORDER_BY_ID = Object.freeze(
  Object.fromEntries(ORDERS.map((order) => [order.id, order])),
);
