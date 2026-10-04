// その場に留まって話しているあいだに、ときどき起こる「まわりの様子」。
//
// 同じ場所で何回か話したら、ときどきユーザーの発言に添えてペルソナに届ける。
// 大きな事件ではなく、BGMや光や風のような、世界が静かに動いていると感じられる小さな変化にする。
// ペルソナは、会話をさえぎらずに、さりげなく取り入れてもいいし、ふれなくてもいい。
//
// id    … 一日に同じものが二度出ないようにするための名前
// when  … その時間帯のときだけ（朝・昼・夕暮れ・夜）
// cast  … スタッフなどほかの登場人物が出てくるもの（「ほかの登場人物」がオフなら出さない）
//
// 方針: 魔法や不思議は使わない。現実の遊園地で起こりうる、ささやかで美しいことにする。
//
// 「ほかの登場人物」がオンのときは、スタッフやほかのお客さんが、ふらっと近づいてきて
// ひと言話しかけ、すぐに離れていく出来事も起こる（cast: true のもの）。

// どの施設でも起こりうること
export const AMBIENT_ANY = [
  { id: 'bgm-waltz', text: '園内に流れるBGMが、ゆったりしたワルツに変わった。' },
  { id: 'bgm-music-box', text: '園内のBGMが、オルゴールの音色の曲に変わった。' },
  { id: 'bgm-swing', text: '園内のBGMが、軽やかなスウィングジャズに変わった。' },
  { id: 'breeze', text: 'ふっと風が吹いて、どこかから甘いポップコーンの香りが運ばれてきた。' },
  { id: 'laughter', text: '遠くのほうで、子どもたちの笑い声がはじけた。' },
  { id: 'coaster-far', text: '遠くで木製コースターが坂を落ちていく音と、歓声が小さく聞こえた。' },
  { id: 'bell-hour', text: '時計台の鐘が、園内に響いた。' },
  { id: 'balloon-sky', text: '誰かの手を離れた赤い風船が一つ、ゆっくりと空へのぼっていくのが見えた。' },
  { id: 'birds', text: '頭の上を、鳥の群れが弧を描いて飛んでいった。' },
  { id: 'cloud-shadow', text: '大きな雲が太陽にかかって、あたりが少しだけ涼しくなった。', when: ['朝', '昼'] },
  { id: 'sun-warm', text: '雲が切れて、日差しが肩のあたりをぽかぽかと温めた。', when: ['朝', '昼'] },
  { id: 'lamps-on', text: '園内の街灯が、通りの向こうから順番にぽつぽつとともり始めた。', when: ['夕暮れ'] },
  { id: 'sky-orange', text: '空の色が、気づかないうちに淡いオレンジから桃色に変わっていた。', when: ['夕暮れ'] },
  { id: 'wind-cool', text: '日が傾いて、風が少しだけひんやりしてきた。', when: ['夕暮れ', '夜'] },
  { id: 'first-star', text: '見上げると、空に一番星が光っていた。', when: ['夕暮れ', '夜'] },
  { id: 'night-lights', text: '観覧車のライトアップが、ゆっくりと色を変えはじめた。', when: ['夜'] },
  { id: 'announce', text: '園内放送で、やわらかい声の案内が流れた。「本日はご来園いただき、ありがとうございます」', cast: true },
  { id: 'sweeper', text: '箒を持ったスタッフが、通りすがりに小さく会釈をしていった。', cast: true },
  // ほかのお客さんが、ふらっと話しかけてきて、すぐに離れていく
  { id: 'guest-photo', cast: true, text: 'カメラを持った年配の夫婦が近づいてきて「よかったら、お二人を撮りましょうか？」と声をかけてくれた。撮り終えると、手を振って去っていった。' },
  { id: 'guest-child', cast: true, text: '風船を持った小さな女の子が駆け寄ってきて「なかよしだね！」と言うと、照れたように母親のもとへ走って戻っていった。' },
  { id: 'guest-ask', cast: true, text: '地図を広げた旅行者らしい青年が「時計台って、こっちで合ってますか？」と聞いてきて、お礼を言いながら足早に去っていった。' },
  { id: 'guest-couple', cast: true, text: '同じリストバンドをつけた老夫婦が通りがかり、二人を見て「私たちも、昔ここで」とほほえんで、手をつないで歩いていった。' },
];

// 施設ごとに起こりうること
export const AMBIENT_AT = {
  gate: [
    { id: 'gate-cameo', cast: true, text: '改札係の女性が、パンチを手にしたまま近づいてきて「スタンプカード、一つ目はこのゲートで押せますよ」と笑い、すぐに次のお客さんの切符を切りに戻っていった。' },
    { id: 'gate-crowd', text: 'ゲートの向こうから、開園を待っていた人たちのざわめきが聞こえてきた。' },
  ],
  fountain: [
    { id: 'fountain-cameo', cast: true, text: 'ノズルを磨いていた白髪の職人さんが顔を上げて「次のショーは、いちばん好きな曲なんですよ」と小声で教えてくれ、また黙々と作業に戻っていった。' },
    { id: 'fountain-show', text: '噴水のショーが始まって、水柱が音楽に合わせて空へ伸びた。' },
    { id: 'fountain-mist', text: '風向きが変わって、噴水の細かいしぶきが頬にふれた。' },
  ],
  balloon: [
    { id: 'balloon-cameo', cast: true, text: '風船屋の若い店員さんが、細長い風船で作った小さな花を「おまけです」と差し出して、くるりと背を向けて店先に戻っていった。' },
    { id: 'balloon-wind', text: '風が吹いて、店先の風船がいっせいにくるりと向きを変えた。' },
  ],
  merry: [
    { id: 'merry-cameo', cast: true, text: '油差しを持った木馬の技師さんが通りがかって「今日はオルガンの機嫌がいいんですよ」と目を細め、工具箱を手に機械室へ戻っていった。' },
    { id: 'merry-tune', text: '回転木馬のオルガンの曲が、古いワルツから明るいマーチに変わった。' },
    { id: 'merry-lights', text: '回転木馬の天井の電球が、ふわっと明るさを増した。' },
  ],
  cups: [
    { id: 'cups-cameo', cast: true, text: 'ティースタンドの店員さんが、トレーを片手に「スコーン、ちょうど焼きあがりましたよ」と声をかけ、ほかのテーブルへ足早に向かっていった。' },
    { id: 'cups-tea', text: 'ティースタンドから、新しくいれた紅茶の香りが漂ってきた。' },
  ],
  photo: [
    { id: 'photo-cameo', cast: true, text: '片眼鏡の写真師さんが写真館の戸口から顔を出して「お二人、今の光がいちばんきれいな時間ですよ」と言い、また暗室へ引っ込んでいった。' },
    { id: 'photo-flash', text: '写真館の奥で、マグネシウムのフラッシュがぱっと光った。' },
  ],
  shooting: [
    { id: 'shooting-cameo', cast: true, text: '射的屋のおじいさんが、こっそり身を乗り出して「腕をのばして、角をねらうんだ」とささやき、何事もなかったように店番に戻った。' },
    { id: 'shooting-hit', text: '隣で誰かが景品を倒して、「当たり！」という鐘がからんと鳴った。' },
  ],
  coaster: [
    { id: 'coaster-cameo', cast: true, text: '係員の青年が、安全バーを確かめに来て「最前列、空きましたよ。どうします？」と聞くと、返事を待たずに次の車両へ歩いていった。' },
    { id: 'coaster-creak', text: 'コースターが真上を通り過ぎて、木組みが低くきしむ音が響いた。' },
  ],
  haunted: [
    { id: 'haunted-cameo', cast: true, text: '白いドレスのお化け役のスタッフが、暗がりからすっと現れて小さくおじぎをし「鍵は、高いところにあるかもしれません」とだけ言って、また闇に消えた。' },
    { id: 'haunted-record', text: 'どこかの部屋で、古いレコードの針が飛んで、曲が少しだけ繰り返された。' },
    { id: 'haunted-draft', text: '廊下の奥から、ひんやりした隙間風がすうっと流れてきた。' },
  ],
  churros: [
    { id: 'churros-cameo', cast: true, text: 'チュロス屋の店主が、紙袋を振りながら「チューロス！ 言ってみて！」と陽気に声をかけ、笑いながら揚げ鍋の前に戻っていった。' },
    { id: 'churros-fresh', text: '屋台から、揚げたてのチュロスが上がるじゅわっという音がした。' },
  ],
  clock: [
    { id: 'clock-cameo', cast: true, text: '時計職人の女性が、真鍮の鍵を首から下げて階段を下りてきて「からくり、あと少しで動きますよ」と腕時計を見せ、足早に去っていった。' },
    { id: 'clock-tick', text: '時計台の中で、大きな歯車がかちりと一つ進む音がした。' },
  ],
  bench: [
    { id: 'bench-cameo', cast: true, text: '箒を持った園丁のおじいさんが、木の根元の落ち葉を集めながら「この木は、ここで休んだ人の話をよく聞いてるよ」と笑い、ゆっくり遠ざかっていった。' },
    { id: 'bench-leaves', text: '風が吹いて、クスノキの葉がいっせいにさわさわと鳴った。' },
    { id: 'bench-squirrel', text: 'リスが一匹、ベンチのはしまで下りてきて、こちらをじっと見ている。' },
  ],
  parade: [
    { id: 'parade-cameo', cast: true, text: '列から少し離れたダンサーが、くるりと回って二人の前で一礼し、ウインクを一つ残して、また行列の中に戻っていった。' },
    { id: 'parade-drum', text: 'ブラスバンドの大太鼓の音が、すぐそばを通り過ぎていった。' },
    { id: 'parade-confetti', text: '紙吹雪の残りが、風に乗って二人の足元に舞い降りた。' },
  ],
  portrait: [
    { id: 'portrait-cameo', cast: true, text: '絵描きさんが絵筆を止めて「お二人、さっきからずっと同じ方向を見てますね」とくすっと笑い、またイーゼルに向き直った。' },
    { id: 'portrait-brush', text: '絵筆を洗う水の、かすかな音がした。' },
  ],
  mirror: [
    { id: 'mirror-cameo', cast: true, text: '迷路の中で、鏡を拭いていたスタッフとばったり会った。「出口は右、と言いたいところですが、内緒です」と笑って、鏡の向こうへ消えていった。' },
    { id: 'mirror-echo', text: '迷路のどこかで、別のお客さんが鐘を鳴らす音が響いた。' },
  ],
  splash: [
    { id: 'splash-cameo', cast: true, text: '無口な船頭さんが、ボートを岸に寄せながら、ぼそっと「洞窟の中では、少しだけ静かに」と言い、また黙って櫂を握った。' },
    { id: 'splash-fish', text: '水面で魚が小さくはねて、輪が広がった。' },
    { id: 'splash-drip', text: '洞窟の天井から、水滴がぽつりと落ちた。' },
  ],
  shop: [
    { id: 'shop-cameo', cast: true, text: '雑貨店のおばあさんが、棚の向こうから顔を出して「その包み紙、きっとお似合いですよ」とほほえみ、またレジの奥へ戻っていった。' },
    { id: 'shop-musicbox', text: '店の奥で、誰かが試しに鳴らしたオルゴールの音が流れた。' },
  ],
  wheel: [
    { id: 'wheel-cameo', cast: true, text: '乗り場の係員さんが、ゴンドラの扉を閉める直前に「てっぺんで、海のほうを見てみてください」とだけ言って、そっと扉を閉めた。' },
    { id: 'wheel-sway', text: '風が吹いて、ゴンドラがゆりかごのようにゆっくり揺れた。' },
  ],
  fireworks: [
    { id: 'fireworks-cameo', cast: true, text: '丘の下を通りがかった花火師の法被の男性が「最後の一発、うちの親方の自信作です」と言い残して、打ち上げ場のほうへ駆けていった。' },
    { id: 'fireworks-wave', text: '花火の合間の静けさに、波の音がよく聞こえた。' },
  ],
};

// 次に起こる「まわりの様子」を一つ選ぶ。もう起きたもの（used）は選ばない
export function pickAmbient(squareId, time, { cast = true, used = [], rand = Math.random } = {}) {
  const usedSet = new Set(used);
  const ok = (a) => !usedSet.has(a.id) && (!a.when || a.when.includes(time)) && (cast || !a.cast);
  const here = (AMBIENT_AT[squareId] || []).filter(ok);
  const any = AMBIENT_ANY.filter(ok);
  // その施設ならではのことを、少し多めに選ぶ
  const pool = here.length && rand() < 0.5 ? here : (any.length ? any : here);
  if (!pool.length) return null;
  return pool[Math.floor(rand() * pool.length)];
}
