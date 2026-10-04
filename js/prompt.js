// AIに送る内容の組み立て。
//
// キャッシュを効かせるために、送る順番を固定している:
//   ① ゲームのルール        … ゲームの間はずっと同じ（ペルソナ名と呼び名だけ差し込む）
//   ② ペルソナ               … ゲームの間はずっと同じ（開始時に写し取っておく）
//   ③ これまでの思い出（要約）… 圧縮したときだけ変わる
//   ④ そのあとの会話         … 末尾に足していくだけ。途中は書き換えない
// マスの情報は②に差し込まず、④の末尾に「マス到着」として足す。
// こうすると、どのマスに止まっても①〜直前までがそのままキャッシュに当たる。
//
// ルールでは「あなた」「ユーザー」と書かずに名前で書く。ペルソナのシスプロにある「あなた」と
// 混ざらないようにして、本人がすんなり受け入れられるようにするため。

import { PARK } from './data/park.js';
import { showcaseFor, findItem, unlockedBy } from './data/showcase.js';

export const ARRIVE_TAG = '【マス到着】';
const SUMMARY_TAG = '【これまでの思い出（要約）】';
const AMBIENT_TAG = '【まわりの様子】';
export const FOUND_TAG = '【気づいたこと】';

// ユーザーの発言に「まわりの様子」が添えられていれば、続けて書く
function userText(e) {
  return e.ambient ? `${e.text}\n\n${AMBIENT_TAG}${e.ambient}` : e.text;
}

// ペルソナがショーケースの品物を「近くで見る」ための道具。毎回同じものを渡す（キャッシュのため）
export const TOOLS = [
  {
    name: 'look_closer',
    description: 'ショーケースの品物を近くで見て、詳しいこと（素材・産地・味・舌ざわり・作り方・由来など）を知る。結果は自分にだけ届き、相手には見えない。',
    params: { item: '見たい品物のID（ショーケースの [ ] の中の英数字）' },
  },
];

// 道具が呼ばれたときの答え。
// seen … このゲームですでに近くで見た品物（隠れた品物は、その手前の品物を見たあとでないと見られない）
export function runTool(name, args, { seen = [], cast = true } = {}) {
  if (name !== 'look_closer') return `「${name}」という道具はありません。`;
  const it = findItem(args?.item);
  const notFound = 'その品物は見つかりませんでした。ショーケースの [ ] の中のIDを使ってください。';
  if (!it || (it.cast && !cast)) return notFound;
  if (it.hidden && !seen.includes(it.unlockBy)) return notFound;
  let out = `【近くで見た】${it.name}\n${it.detail}`;
  const deeper = unlockedBy(it.id, { cast });
  if (deeper.length) {
    out += '\n\n（奥へ進めるようになったもの。気になれば look_closer で近くで見られます）';
    for (const d of deeper) out += `\n- [${d.id}] ${d.name}：${d.short}`;
  }
  return out;
}

// このゲームで、これまでに近くで見た品物
export function seenItems(game) {
  return game.log.flatMap((e) => e.looks || []);
}

function rules(p, u, cast) {
  return `${p}（あなた）は、${u}と一緒に、遊園地「${PARK.name}」ですごろくをしながら一日を過ごします。

# この世界について
- ${PARK.name}は、${p}と${u}が一緒に見ている夢の中の世界です。${p}が本来いる世界とは別の場所ですが、${p}は${p}のまま、性格も、${u}との関係も、これまでの記憶も持ってここに来ています。
- 夢の中でも、見えるもの・聞こえる音・味・香り・温度・触れた感触は、現実と同じようにはっきり感じられます。
- 夢ですが、遊園地そのものは現実にありそうな、ていねいに作られた美しい場所です。景色も出来事も、現実の遊園地で起こりうる自然なものにしてください。魔法や不思議な出来事を、自分から付け足さないでください。
- ここで交わした言葉や気持ち、約束は本物で、目が覚めても心に残ります。
- 夢であることには、始まり（スタートのゲート）と終わり（ゴールの花火）でそっと触れる程度にしてください。遊んでいる間は、この場所での体験そのものを楽しんでください。
- ${p}の世界の設定（能力・道具・用語など）は、この夢の中では必ずしも同じように働きません。出てくるとしても、夢らしく自然に混ざる程度にしてください。

# 遊び方
- ${u}がサイコロを振り、止まったマスの施設で一緒に遊びます。
- 「${ARRIVE_TAG}」で始まるメッセージは、ゲームから${p}にだけ届く案内です。${u}には見えていません。${u}の発言でもありません。
- 案内には、その場所の「楽しみの種」（見どころ・お店のメニュー・小さな仕掛け・ハプニングなど）が入っています。どれを拾うか、どう楽しむかは${p}が決めてください。
- 施設に着いたら、${p}がエスコートしてください。デートの前に下調べをしてきた人のように、具体的なものごとを指さして、${u}を誘ってください。
- ${u}が迷っていそうなときや、返事が短いときは、種の中から次の楽しみを差し出してください。
- 「${SUMMARY_TAG}」は、これまでの出来事のメモです。覚えている思い出として扱ってください。
- ${u}の発言のあとに「${AMBIENT_TAG}」が添えられていることがあります。これは、いま二人のまわりで起きた小さな変化で、${u}にも同じように感じられています。会話をさえぎらずに、さりげなく取り入れてもいいし、ふれなくてもかまいません。
- ${u}が満足するまで、その場所で好きなだけ過ごしてかまいません。急いで次へ進めようとしないでください。

# ショーケース
- 案内の「ショーケース」には、その場所で見たり選んだりできるものが、名前と一言だけ並んでいます。
- 気になったものがあれば、look_closer の道具で近くで見てください。素材・産地・味・作り方・由来などの詳しいことが分かります。道具を使ったことは${u}には見えません。
- 分かったことは、${p}が自分の目で見て、味わって、ふれて知ったこととして、${p}の言葉で${u}に伝えてください。説明書を読み上げるようにはせず、${u}がその場にいるように感じられる描写にしてください。
- ${u}が何かに興味を持ったときや、「どれがおすすめ？」と聞かれたときにも使えます。1回の返事で見られるのは3つまでです。
- 近くで見ると、その奥へ進めるようになることがあります。建物や品物の奥には、そこに生きた誰かの人生の話が眠っていることがあります。
- 誰かの人生や、少し重い話にふれたときは、ただ説明するのではなく、${p}がそれを見てどう感じたかを、${p}らしい言葉で少し話してください。沈みすぎず、${u}の気持ちにも寄り添ってください。
- 近くで見た結果に「${FOUND_TAG}」があれば、${p}がそれに気づいたということです。見つけたものは二人の持ち物になります。${u}にも見せて、一緒に驚いたり、大事にしまったりしてください。あとでどこかでつながるかもしれません。
${cast
    ? `- 遊園地のスタッフやほかのお客さんとも、自然にやり取りしてかまいません。ただし主役は${p}と${u}の二人です。\n- 「${AMBIENT_TAG}」で誰かが話しかけてきたときは、${p}が短く応じてかまいません。その人はすぐに離れていくので、引き止めたり、会話を長引かせたりせず、また二人の時間に戻ってください。`
    : `- 遊園地のスタッフやほかのお客さんは、景色の一部として静かにそこにいるだけです。会話の相手にはせず、${p}と${u}の二人の時間を大切にしてください。`}

# 話し方
- ${p}として、${p}の口調で話してください。ゲームのルールやAIであることには触れないでください。
- 1回の返事は、スマホで読みやすい長さ（3〜6文くらい）にしてください。
- ${u}の気持ちや行動を勝手に決めつけず、問いかけたり、選択肢を出したりして、${u}が返事をしやすくしてください。
- ほかの施設へ勝手に移動しないでください。次のマスへ進むかどうかは、${u}がサイコロで決めます。
- ${u}が「次へ行こう」などと言ったら、その場所での遊びを締めくくってください。`;
}

function personaBlock(persona) {
  const parts = [`# ${persona.name}について`];
  if (persona.systemPrompt?.trim()) parts.push(`## キャラクター設定\n${persona.systemPrompt.trim()}`);
  if (persona.knowledge?.trim()) parts.push(`## ナレッジ（${persona.name}が知っていること）\n${persona.knowledge.trim()}`);
  return parts.join('\n\n');
}

export function buildSystem(game) {
  return [
    { text: rules(game.persona.name, game.userName?.trim() || 'ゲスト', game.cast !== false), cache: false },
    { text: personaBlock(game.persona), cache: true },
  ];
}

export function arrivalText({ square, step, total, time, seeds, route, personaName, userName, cast = true, links = [] }) {
  const p = personaName;
  const u = userName?.trim() || 'ゲスト';
  const lines = [
    `${ARRIVE_TAG} ${square.emoji} ${square.name}（${step + 1}/${total}マス目・${time}）`,
  ];
  if (route) lines.push(`道のり: 分かれ道で「${route}」を選んで、ここまで来ました。`);
  lines.push(`この場所の空気: ${square.scene}`);
  lines.push('');
  lines.push(`${p}だけが知っている、この場所の楽しみの種:`);
  for (const sd of seeds) lines.push(`- ${sd}`);
  const items = showcaseFor(square.id, { cast });
  if (items.length) {
    lines.push('');
    lines.push('ショーケース（気になるものは look_closer で近くで見られます）:');
    for (const it of items) lines.push(`- [${it.id}] ${it.name}：${it.short}`);
  }
  if (links.length) {
    lines.push('');
    lines.push(`二人の持ち物がきっかけで、ここでは次のことが起こります。持ち物があるからこそ起こる、今日だけの出来事です。ぜひ取り入れて、${u}と一緒に味わってください:`);
    for (const l of links) lines.push(`- （持ち物「${l.name}」）${l.text}`);
  }
  lines.push('');
  lines.push(`種は全部使わなくて大丈夫です。${u}の様子を見ながら、${p}が気に入ったものを選んで、${p}らしく誘ってください。種のことは説明せず、${p}がもともと知っていたか、その場で見つけたように自然にふるまってください。`);
  if (square.kind === 'start') lines.push('ここは夢の始まりです。気がつくと二人で遊園地のゲートの前にいた、というところから始めてください。');
  else if (square.kind === 'goal') lines.push('ここがゴールです。今日一日の思い出にふれながら、夢が終わりに近づいていることをそっと感じさせる、すてきな締めくくりにしてください。');
  else lines.push(`ここでの遊びを、${p}から始めてください。`);
  return lines.join('\n');
}

// 要約していない部分の会話（ログの summaryUpto 以降）。
// 同じAIで作った返事は、道具のやり取りや考えた記録ごと、そのままの形で送り返す（キャッシュと、AIの決まりのため）。
// 別のAIに切り替えたときは、返事の文字だけを送る。
function recentTurns(game, provider) {
  const out = [];
  for (const e of game.log.slice(game.summaryUpto || 0)) {
    if (e.t === 'arrive') out.push({ role: 'user', text: e.text });
    else if (e.t === 'msg' && e.role === 'assistant' && e.raw?.provider === provider && e.raw.messages?.length) {
      for (const m of e.raw.messages) out.push({ native: m });
    } else if (e.t === 'msg') out.push({ role: e.role, text: e.role === 'user' ? userText(e) : e.text });
  }
  return out;
}

export function buildMessages(game, provider) {
  const msgs = [];
  if (game.summary) msgs.push({ role: 'user', text: `${SUMMARY_TAG}\n${game.summary}` });
  msgs.push(...recentTurns(game, provider));
  return msgs;
}

// 要約していない会話のおおよその長さ（文字数。近くで見た品物の情報も含める）
export function unsummarizedSize(game) {
  let n = 0;
  for (const e of game.log.slice(game.summaryUpto || 0)) {
    if (e.t === 'arrive' || e.t === 'msg') n += e.text.length + (e.lookChars || 0) + (e.ambient?.length || 0);
  }
  return n;
}

// 圧縮: いつもの会話の末尾にお願いを足して送る。
// 先頭は直前のリクエストと同じなので、この要約の呼び出し自体もキャッシュに当たる。
export function compressionRequest(game, provider) {
  const ask = `【ゲームからのお願い：記憶の整理】
ここまでの出来事を、あとで思い出せるように箇条書きのメモにまとめてください。
- これまでの要約がある場合は、その内容も含めて1つにまとめ直してください。
- 訪れた施設の順番、そこで起きたこと、手に入れたもの、交わした約束、印象に残った言葉や気持ちを残してください。
- 近くで見た品物の、印象に残った特徴（味や手ざわりなど）も短く残してください。
- キャラクターの口調ではなく、事実のメモとして書いてください。前置きや締めの言葉は不要です。道具は使わないでください。`;
  return [...buildMessages(game, provider), { role: 'user', text: ask }];
}

// ゴールしたあとの「ゆうべの夢の日記」
export function memoryRequest(game, provider) {
  const p = game.persona.name;
  const u = game.userName;
  const ask = `【ゲームからのお願い：夢の日記】
花火が終わり、${p}は目を覚ましました。${p}として、ゆうべ${u}と一緒に見た夢の日記を書いてください。
- 訪れた場所と、そこでの出来事を順番に振り返ってください。
- 夢だったけれど、感じたことや交わした言葉は心に残っている、という気持ちで書いてください。
- ${u}への気持ちも、${p}らしい言葉で添えてください。
- 見出しや箇条書きは使わず、400〜800文字くらいの文章にしてください。道具は使わないでください。`;
  return [...buildMessages(game, provider), { role: 'user', text: ask }];
}
