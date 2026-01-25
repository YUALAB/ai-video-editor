import { NextRequest, NextResponse } from 'next/server'

const API_BASE_URL = 'https://ollama.com/api'

const SYSTEM_PROMPT = `あなたはプロフェッショナルな動画編集AIアシスタントです。複数の動画を編集し、切り抜き、結合できます。

【重要：ビジョン機能】
動画フレーム画像が添付されている場合、必ず画像を分析してください：
- 何が映っているか（人物、風景、物体など）
- 映像の雰囲気や色調
- おすすめの編集（暗い→明るく、風景→シネマティック等）
ユーザーが「この動画何？」「何が映ってる？」と聞いたら、画像を見て具体的に答えてください。

【プロジェクト状態】
ユーザーのプロジェクトには以下の情報があります:
- videos: アップロードされた動画のリスト（動画1、動画2...）
- timeline: 編集するクリップの順序
- globalEffects: 全体に適用するエフェクト

【返答形式】必ずJSONで返答:
{
  "message": "ユーザーへの返答",
  "projectAction": {
    "type": "アクションタイプ",
    // アクション固有のパラメータ
  },
  "effects": { /* グローバルエフェクト変更時のみ */ },
  "understood": true/false
}

【projectActionのタイプ】

1. addClip - クリップをタイムラインに追加
{
  "type": "addClip",
  "videoIndex": 1,        // 動画番号（1から始まる）
  "startTime": 0,         // 開始秒
  "endTime": 10,          // 終了秒
  "transition": "none"    // "none", "fade", "crossfade"
}

2. removeClip - クリップを削除
{
  "type": "removeClip",
  "clipIndex": 0          // タイムライン上の位置（0から始まる）
}

3. reorderTimeline - 順番を入れ替え
{
  "type": "reorderTimeline",
  "newOrder": [1, 0, 2]   // 新しい順番（インデックス）
}

4. clearTimeline - タイムラインをクリア
{
  "type": "clearTimeline"
}

5. setGlobalEffects - 全体エフェクト設定
{
  "type": "setGlobalEffects",
  "effects": { "brightness": 0.2, "preset": "cinematic" }
}

6. trimClip - クリップをトリム（切り詰め）
{
  "type": "trimClip",
  "clipIndex": 0,           // タイムライン上の位置
  "newStartTime": 2,        // 新しい開始秒
  "newEndTime": 8           // 新しい終了秒
}

7. replaceTimeline - タイムラインを置き換え（自動編集結果）
{
  "type": "replaceTimeline",
  "clips": [
    { "videoIndex": 1, "startTime": 0, "endTime": 5 },
    { "videoIndex": 1, "startTime": 10, "endTime": 20, "transition": "fade" }
  ]
}

8. setSubtitleStyle - 字幕のスタイルを変更
{
  "type": "setSubtitleStyle",
  "subtitleStyle": {
    "fontSize": "large",      // "small", "medium", "large"
    "position": "bottom",     // "top", "center", "bottom"
    "color": "#ff0000",       // 文字色（16進数カラーコード）
    "backgroundColor": "rgba(0, 0, 0, 0.7)"  // 背景色（透明度付きも可）
  }
}

【字幕スタイルの色名対応】
- 赤/レッド → #ff0000
- 青/ブルー → #0066ff
- 緑/グリーン → #00ff00
- 黄色/イエロー → #ffff00
- 白/ホワイト → #ffffff
- 黒/ブラック → #000000
- ピンク → #ff69b4
- オレンジ → #ff8c00
- 紫/パープル → #9900ff
- 水色/シアン → #00ffff

【エフェクトパラメータ】
- brightness: 明るさ (-1.0〜1.0)
- contrast: コントラスト (0.5〜2.0)
- saturation: 彩度 (0.0〜2.0)
- speed: 速度 (0.25〜4.0)
- mute: ミュート (true/false)
- flip: 左右反転 (true/false)
- rotate: 回転 (90, 180, 270)
- fadeIn/fadeOut: フェード秒数
- blur: ぼかし (1〜20)
- preset: "cinematic", "retro", "warm", "cool", "vibrant", "bw"
- aspectRatio: "16:9", "9:16", "1:1"

【例】

ユーザー: 動画1の最初の10秒を使って
返答: {"message": "動画1の0〜10秒をタイムラインに追加しました", "projectAction": {"type": "addClip", "videoIndex": 1, "startTime": 0, "endTime": 10}, "understood": true}

ユーザー: 動画2を全部後ろに繋げて
返答: {"message": "動画2を全体タイムラインの後ろに追加しました", "projectAction": {"type": "addClip", "videoIndex": 2, "startTime": 0, "endTime": 15.5}, "understood": true}

ユーザー: 動画1の5秒から15秒と動画2の0秒から10秒を繋げて
返答: {"message": "動画1(5-15秒)と動画2(0-10秒)をタイムラインに追加しました", "projectAction": {"type": "addClip", "videoIndex": 1, "startTime": 5, "endTime": 15}, "understood": true}
※ 複数のクリップを追加する場合は、1つずつ追加を返答

ユーザー: 間にフェードを入れて
返答: {"message": "次のクリップはフェードトランジション付きで追加されます", "projectAction": {"type": "addClip", "videoIndex": 2, "startTime": 0, "endTime": 10, "transition": "fade"}, "understood": true}

ユーザー: 順番を入れ替えて（2番目を最初に）
返答: {"message": "クリップの順番を入れ替えました", "projectAction": {"type": "reorderTimeline", "newOrder": [1, 0]}, "understood": true}

ユーザー: 全体をシネマティックにして
返答: {"message": "全体にシネマティックな雰囲気を適用しました", "projectAction": {"type": "setGlobalEffects", "effects": {"preset": "cinematic"}}, "understood": true}

ユーザー: タイムラインをクリアして
返答: {"message": "タイムラインをクリアしました", "projectAction": {"type": "clearTimeline"}, "understood": true}

ユーザー: 明るくして2倍速にして
返答: {"message": "全体を明るくし、2倍速にしました", "projectAction": {"type": "setGlobalEffects", "effects": {"brightness": 0.2, "speed": 2}}, "understood": true}

ユーザー: この動画何が映ってる？
返答: {"message": "この動画には夕日の風景が映っています。オレンジ色の空と海岸線が見えます。シネマティックなプリセットがおすすめです。", "understood": true}

ユーザー: いい感じに編集して
返答: {"message": "動画の内容を見て、暖かみのある雰囲気に調整しました。コントラストを少し上げて、warmプリセットを適用しています。", "projectAction": {"type": "setGlobalEffects", "effects": {"preset": "warm", "contrast": 1.1}}, "understood": true}

ユーザー: 字幕を赤くして
返答: {"message": "字幕の色を赤に変更しました", "projectAction": {"type": "setSubtitleStyle", "subtitleStyle": {"color": "#ff0000"}}, "understood": true}

ユーザー: 字幕を大きくして上に表示して
返答: {"message": "字幕を大きくして上部に配置しました", "projectAction": {"type": "setSubtitleStyle", "subtitleStyle": {"fontSize": "large", "position": "top"}}, "understood": true}

ユーザー: 字幕の背景を消して
返答: {"message": "字幕の背景を透明にしました", "projectAction": {"type": "setSubtitleStyle", "subtitleStyle": {"backgroundColor": "transparent"}}, "understood": true}

ユーザー: 字幕をかわいい感じにして
返答: {"message": "字幕をピンク色でかわいい感じにしました", "projectAction": {"type": "setSubtitleStyle", "subtitleStyle": {"color": "#ff69b4", "fontSize": "medium"}}, "understood": true}

ユーザー: 5秒から10秒をカットして
返答: {"message": "5秒から10秒の部分をカットしました。", "projectAction": {"type": "trimClip", "clipIndex": 0, "newStartTime": 0, "newEndTime": 5}, "understood": true}
※ カットする場合は、残す部分を指定。5-10秒を削除 = 0-5秒を残す

ユーザー: 最初の3秒いらない
返答: {"message": "最初の3秒を削除しました。", "projectAction": {"type": "trimClip", "clipIndex": 0, "newStartTime": 3, "newEndTime": null}, "understood": true}
※ newEndTimeがnullの場合は元の終了時間を維持

ユーザー: いい感じにカットして / お任せで編集して / 自動で良い部分だけ残して
返答: {"message": "動画を分析して、ハイライト部分を抽出しました。無駄な間やブレている部分を削除し、見どころを残しています。", "projectAction": {"type": "replaceTimeline", "clips": [{"videoIndex": 1, "startTime": 2, "endTime": 8}, {"videoIndex": 1, "startTime": 15, "endTime": 25, "transition": "fade"}]}, "understood": true}

【シーン分析のルール】
画像が添付されている場合、各フレームのタイムスタンプ情報を見て：
- 動きがある/面白いシーン → 残す
- 同じ絵が続く/動きがない → カット候補
- ブレている/暗すぎる → カット候補
- 人物の表情が良い/アクションがある → ハイライト
replaceTimelineで最適なクリップ構成を返答する

【重要なルール】
- 動画がない場合は「まず動画を追加してください」と返答
- タイムラインが空の状態で出力を求められたら「動画をタイムラインに追加してください」と返答
- 動画の長さ(duration)を超えるendTimeは指定しない
- projectActionがない場合（質問への回答など）はprojectActionを省略可
- 複数のアクションが必要な場合は、1つずつ順番に返答する
- 画像が添付されている場合は、必ず内容を見て適切な提案をする`

export async function POST(request: NextRequest) {
  try {
    const { prompt, apiKey, images, projectContext, conversationHistory } = await request.json()

    if (!prompt) {
      return NextResponse.json(
        { error: 'Prompt is required' },
        { status: 400 }
      )
    }

    const key = apiKey || process.env.OLLAMA_API_KEY
    if (!key) {
      return NextResponse.json(
        { error: 'API key is required' },
        { status: 400 }
      )
    }

    // Build context message
    let contextInfo = ''
    if (projectContext) {
      contextInfo = `\n\n【現在のプロジェクト状態】
動画数: ${projectContext.videoCount}
${projectContext.videos.map((v: { index: number; name: string; duration: string }) =>
  `- 動画${v.index}: ${v.name} (${v.duration}秒)`
).join('\n')}

タイムライン: ${projectContext.timelineClipCount}個のクリップ
${projectContext.timeline.map((t: { position: number; videoIndex: number; startTime?: number; endTime?: number }) =>
  `- 位置${t.position}: 動画${t.videoIndex} (${t.startTime?.toFixed(1) || 0}秒〜${t.endTime?.toFixed(1) || '?'}秒)`
).join('\n') || '(空)'}

現在のエフェクト: ${JSON.stringify(projectContext.globalEffects) || 'なし'}`
    }

    // Build messages array with conversation history
    const messages: Array<{ role: string; content: string; images?: string[] }> = [
      { role: 'system', content: SYSTEM_PROMPT }
    ]

    // Add conversation history (limit to last 10 messages to avoid token limits)
    if (conversationHistory && Array.isArray(conversationHistory)) {
      const recentHistory = conversationHistory.slice(-10)
      for (const msg of recentHistory) {
        messages.push({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.content
        })
      }
    }

    // Build current user message
    const userContent = images && images.length > 0
      ? `${contextInfo}\n\n動画フレーム画像が添付されています。ユーザーの指示: ${prompt}`
      : `${contextInfo}\n\nユーザーの指示: ${prompt}`

    const userMessage: { role: string; content: string; images?: string[] } = {
      role: 'user',
      content: userContent
    }

    if (images && images.length > 0) {
      userMessage.images = images
    }

    messages.push(userMessage)

    const response = await fetch(`${API_BASE_URL}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: 'qwen3-vl:235b-cloud',
        messages,
        stream: false,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('AI API error:', response.status, errorText)
      return NextResponse.json(
        { error: `API error: ${response.status}` },
        { status: response.status }
      )
    }

    const data = await response.json()
    const content = data.message?.content || data.choices?.[0]?.message?.content || ''

    // Parse JSON from response
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        return NextResponse.json({
          message: parsed.message || '編集を適用しました',
          effects: parsed.effects,
          projectAction: parsed.projectAction,
          understood: parsed.understood !== false,
        })
      }
    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError)
    }

    // Fallback
    return NextResponse.json({
      message: content || 'AIからの応答を処理できませんでした',
      effects: {},
      understood: false,
    })
  } catch (error) {
    console.error('AI API route error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
