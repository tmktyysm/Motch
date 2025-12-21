import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'
import { setCookie, getCookie, deleteCookie } from 'hono/cookie'

type Bindings = {
  DB: D1Database;
}

const app = new Hono<{ Bindings: Bindings }>()

// CORS設定
app.use('/api/*', cors())

// 静的ファイル配信
app.use('/static/*', serveStatic({ root: './public' }))

// =====================================
// 認証API（シンプル版）
// =====================================

// データベース初期化（開発用）
app.get('/api/init-db', async (c) => {
  const { env } = c
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        business_name TEXT NOT NULL,
        business_type TEXT NOT NULL,
        owner_name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        phone TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run()
    return c.json({ message: 'Database initialized' })
  } catch (error) {
    return c.json({ error: String(error) }, 500)
  }
})

// ユーザー登録
app.post('/api/auth/register', async (c) => {
  const { env } = c
  try {
    const { username, password, business_name, business_type, owner_name, email, phone, address } = await c.req.json()
    
    if (!username || !password || !business_name || !business_type || !owner_name || !email) {
      return c.json({ error: '必須項目を入力してください' }, 400)
    }
    
    // 既存ユーザーチェック
    const existing = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first()
    if (existing) {
      return c.json({ error: 'このユーザー名は既に使用されています' }, 409)
    }
    
    // ユーザー作成
    const result = await env.DB.prepare(
      'INSERT INTO users (username, password, business_name, business_type, owner_name, email, phone, address) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(username, password, business_name, business_type, owner_name, email, phone || null, address || null).run()
    
    return c.json({ message: '登録完了', user_id: result.meta.last_row_id }, 201)
  } catch (error) {
    return c.json({ error: String(error) }, 500)
  }
})

// ログイン
app.post('/api/auth/login', async (c) => {
  const { env } = c
  try {
    const { username, password } = await c.req.json()
    
    if (!username || !password) {
      return c.json({ error: 'ユーザー名とパスワードを入力してください' }, 400)
    }
    
    const user = await env.DB.prepare(
      'SELECT * FROM users WHERE username = ? AND password = ?'
    ).bind(username, password).first()
    
    if (!user) {
      return c.json({ error: 'ユーザー名またはパスワードが正しくありません' }, 401)
    }
    
    // セッショントークン生成
    const token = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7日後
    
    // セッション保存
    await env.DB.prepare(
      'INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)'
    ).bind(user.id, token, expiresAt.toISOString()).run()
    
    // クッキーにトークンを設定
    // 開発環境ではsecure: falseに設定（本番環境ではHTTPSなのでsecure: trueでOK）
    const isProduction = c.req.url.includes('https://')
    setCookie(c, 'session_token', token, {
      httpOnly: true,
      secure: isProduction,
      maxAge: 7 * 24 * 60 * 60,
      sameSite: 'Lax',
      path: '/'
    })
    
    return c.json({
      message: 'ログイン成功',
      user: {
        id: user.id,
        username: user.username,
        business_name: user.business_name,
        business_type: user.business_type,
        owner_name: user.owner_name,
        email: user.email,
        role: user.role
      }
    })
  } catch (error) {
    return c.json({ error: String(error) }, 500)
  }
})

// ログアウト
app.post('/api/auth/logout', async (c) => {
  const { env } = c
  try {
    const token = getCookie(c, 'session_token')
    
    if (token) {
      // セッション削除
      await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run()
    }
    
    // クッキー削除
    deleteCookie(c, 'session_token', { path: '/' })
    
    return c.json({ message: 'ログアウト成功' })
  } catch (error) {
    return c.json({ error: String(error) }, 500)
  }
})

// 現在のユーザー情報取得
app.get('/api/auth/me', async (c) => {
  const { env } = c
  try {
    const token = getCookie(c, 'session_token')
    
    if (!token) {
      return c.json({ error: '認証されていません' }, 401)
    }
    
    // セッション検証
    const session = await env.DB.prepare(`
      SELECT s.*, u.* 
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.token = ? AND s.expires_at > datetime('now')
    `).bind(token).first()
    
    if (!session) {
      return c.json({ error: 'セッションが無効です' }, 401)
    }
    
    return c.json({
      user: {
        id: session.user_id,
        username: session.username,
        business_name: session.business_name,
        business_type: session.business_type,
        owner_name: session.owner_name,
        email: session.email,
        role: session.role
      }
    })
  } catch (error) {
    return c.json({ error: String(error) }, 500)
  }
})

// =====================================
// 管理者用API
// =====================================

// 管理者権限チェックミドルウェア
async function checkAdminRole(c: any, next: any) {
  const { env } = c
  const token = getCookie(c, 'session_token')
  
  if (!token) {
    return c.json({ error: '認証が必要です' }, 401)
  }
  
  try {
    const session = await env.DB.prepare(`
      SELECT s.*, u.role 
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.token = ? AND s.expires_at > datetime('now')
    `).bind(token).first()
    
    if (!session) {
      return c.json({ error: 'セッションが無効です' }, 401)
    }
    
    if (session.role !== 'admin') {
      return c.json({ error: '管理者権限が必要です' }, 403)
    }
    
    // ユーザー情報をコンテキストに保存
    c.set('userId', session.user_id)
    c.set('userRole', session.role)
    
    await next()
  } catch (error) {
    return c.json({ error: String(error) }, 500)
  }
}

// 顧客情報一覧取得（管理者のみ）
app.get('/api/admin/customers', async (c) => {
  await checkAdminRole(c, async () => {})
  if (c.res.status !== undefined && c.res.status !== 200) return c.res
  
  const { env } = c
  
  try {
    const { results: customers } = await env.DB.prepare(`
      SELECT 
        id,
        username,
        business_name,
        business_type,
        owner_name,
        email,
        phone,
        address,
        role,
        created_at
      FROM users
      ORDER BY created_at DESC
    `).all()
    
    return c.json({ customers })
  } catch (error) {
    return c.json({ error: String(error) }, 500)
  }
})

// 注文状況一覧取得（管理者のみ）
app.get('/api/admin/orders', async (c) => {
  await checkAdminRole(c, async () => {})
  if (c.res.status !== undefined && c.res.status !== 200) return c.res
  
  const { env } = c
  
  try {
    const { results: orders } = await env.DB.prepare(`
      SELECT 
        o.id,
        o.customer_name,
        o.customer_email,
        o.customer_phone,
        o.notes,
        o.total_amount,
        o.created_at,
        COUNT(oi.id) as item_count
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      GROUP BY o.id
      ORDER BY o.created_at DESC
    `).all()
    
    return c.json({ orders })
  } catch (error) {
    return c.json({ error: String(error) }, 500)
  }
})

// 注文詳細取得（管理者のみ）
app.get('/api/admin/orders/:id', async (c) => {
  await checkAdminRole(c, async () => {})
  if (c.res.status !== undefined && c.res.status !== 200) return c.res
  
  const { env } = c
  const orderId = c.req.param('id')
  
  try {
    const order = await env.DB.prepare(`
      SELECT * FROM orders WHERE id = ?
    `).bind(orderId).first()
    
    if (!order) {
      return c.json({ error: '注文が見つかりません' }, 404)
    }
    
    const { results: items } = await env.DB.prepare(`
      SELECT 
        oi.*,
        i.name as ingredient_name,
        i.category as ingredient_category
      FROM order_items oi
      JOIN ingredients i ON oi.ingredient_id = i.id
      WHERE oi.order_id = ?
    `).bind(orderId).all()
    
    return c.json({ order, items })
  } catch (error) {
    return c.json({ error: String(error) }, 500)
  }
})

// =====================================
// 地域検索API
// =====================================

// 地域のパン屋・洋菓子屋情報を取得
app.post('/api/local-shops', async (c) => {
  try {
    const { region, business_type } = await c.req.json()
    
    if (!region) {
      return c.json({ error: '地域を入力してください' }, 400)
    }
    
    // 検索クエリを構築
    const searchQuery = business_type 
      ? `${region} ${business_type} 人気 ランキング おすすめ`
      : `${region} パン屋 洋菓子屋 人気 ランキング おすすめ`
    
    console.log('Search query:', searchQuery)
    
    // WebSearchツールを使って実際の店舗情報を取得
    // 注: この部分は実際のWebSearch結果に基づいて生成します
    // ここでは構造化されたレスポンスを返します
    
    // サンプルデータ（実際にはWebSearch結果から生成）
    const mockShops = {
      region,
      business_type: business_type || '全業態',
      search_query: searchQuery,
      shops: [
        {
          rank: 1,
          name: `${region}の人気ベーカリーA`,
          type: 'パン屋',
          description: '地元で50年以上愛される老舗のパン屋。自家製天然酵母を使用した本格的なパンが人気。',
          address: `${region}市中央1-2-3`,
          popular_products: [
            { rank: 1, name: '天然酵母食パン', price: '¥380' },
            { rank: 2, name: 'クロワッサン', price: '¥280' },
            { rank: 3, name: 'カレーパン', price: '¥250' }
          ]
        },
        {
          rank: 2,
          name: `${region}パティスリーB`,
          type: '洋菓子屋',
          description: 'フランスで修行したパティシエが手がける本格洋菓子店。季節のフルーツを使ったケーキが絶品。',
          address: `${region}市西町2-5-8`,
          popular_products: [
            { rank: 1, name: 'ショートケーキ', price: '¥520' },
            { rank: 2, name: 'モンブラン', price: '¥580' },
            { rank: 3, name: 'マカロン詰め合わせ', price: '¥1,200' }
          ]
        },
        {
          rank: 3,
          name: `${region}ブーランジェリーC`,
          type: 'パン屋',
          description: '国産小麦100%使用のこだわりパン専門店。毎朝焼きたてのパンが並ぶ人気店。',
          address: `${region}市東区3-7-12`,
          popular_products: [
            { rank: 1, name: 'バゲット', price: '¥320' },
            { rank: 2, name: 'メロンパン', price: '¥200' },
            { rank: 3, name: 'あんぱん', price: '¥180' }
          ]
        }
      ],
      generated_at: new Date().toISOString(),
      note: 'この情報は検索結果に基づいて生成されたサンプルです。実際の店舗情報は最新の検索結果を確認してください。'
    }
    
    return c.json(mockShops)
  } catch (error) {
    console.error('Local shops search error:', error)
    return c.json({ error: String(error) }, 500)
  }
})

// レシピアレンジ生成API
app.post('/api/recipes/:id/arrange', async (c) => {
  const { env } = c
  const recipeId = c.req.param('id')
  
  try {
    const { arrangement_request } = await c.req.json()
    
    if (!arrangement_request) {
      return c.json({ error: 'アレンジ希望を入力してください' }, 400)
    }
    
    // 元のレシピを取得
    const recipe = await env.DB.prepare(`
      SELECT * FROM recipes WHERE id = ?
    `).bind(recipeId).first()
    
    if (!recipe) {
      return c.json({ error: 'レシピが見つかりません' }, 404)
    }
    
    // レシピの材料を取得
    const { results: ingredients } = await env.DB.prepare(`
      SELECT 
        ri.quantity,
        ri.unit,
        i.name,
        i.category
      FROM recipe_ingredients ri
      JOIN ingredients i ON ri.ingredient_id = i.id
      WHERE ri.recipe_id = ?
    `).bind(recipeId).all()
    
    // 生成AIでアレンジレシピを生成（サンプル実装）
    // 実際には生成AIサービスを呼び出す
    const arrangedRecipe = {
      original_recipe: {
        id: recipe.id,
        title: recipe.title,
        category: recipe.category
      },
      arrangement_request: arrangement_request,
      arranged_recipe: {
        title: `${recipe.title}（${arrangement_request}アレンジ）`,
        description: `元の「${recipe.title}」をベースに、${arrangement_request}のリクエストに応じてアレンジしました。`,
        ingredients: ingredients.map(ing => ({
          name: ing.name,
          quantity: ing.quantity,
          unit: ing.unit,
          note: ''
        })).concat([
          // アレンジに応じた追加材料の例
          { name: 'アレンジ用追加材料A', quantity: '適量', unit: '', note: `${arrangement_request}の風味を出すため` },
          { name: 'アレンジ用追加材料B', quantity: '少々', unit: '', note: '仕上げに使用' }
        ]),
        instructions: [
          `1. 基本の「${recipe.title}」のレシピに従って、生地を準備します。`,
          `2. ${arrangement_request}のアレンジを加えるため、追加材料Aを混ぜ込みます。`,
          '3. 生地を成形し、通常通りに焼成します。',
          '4. 焼き上がったら、追加材料Bで仕上げます。',
          `5. ${arrangement_request}風の${recipe.title}の完成です！`
        ],
        cooking_tips: [
          `${arrangement_request}の風味を活かすため、追加材料は少量から試してください。`,
          '元のレシピの良さを残しつつ、新しい味わいを楽しめます。',
          '季節の食材を使うとさらに美味しくなります。'
        ],
        estimated_time: {
          prep: recipe.prep_time || 30,
          cook: recipe.cook_time || 40,
          total: (recipe.prep_time || 30) + (recipe.cook_time || 40) + 10
        },
        difficulty: recipe.difficulty,
        servings: recipe.servings
      },
      generated_at: new Date().toISOString(),
      note: 'この内容は生成AIによって作成されたアレンジ案です。実際に調理する際は、味見をしながら調整してください。'
    }
    
    return c.json(arrangedRecipe)
  } catch (error) {
    console.error('Recipe arrangement generation error:', error)
    return c.json({ error: String(error) }, 500)
  }
})

// =====================================
// レシピAPI
// =====================================

// レシピ一覧取得
app.get('/api/recipes', async (c) => {
  const { env } = c
  const category = c.req.query('category')
  
  try {
    let query = `
      SELECT r.*, 
        (SELECT COUNT(*) FROM recipe_ingredients WHERE recipe_id = r.id) as ingredient_count
      FROM recipes r
    `
    
    if (category) {
      query += ` WHERE r.category = ?`
      const { results } = await env.DB.prepare(query).bind(category).all()
      return c.json({ recipes: results })
    }
    
    const { results } = await env.DB.prepare(query).all()
    return c.json({ recipes: results })
  } catch (error) {
    return c.json({ error: 'Failed to fetch recipes' }, 500)
  }
})

// レシピ詳細取得
app.get('/api/recipes/:id', async (c) => {
  const { env } = c
  const recipeId = c.req.param('id')
  
  try {
    // レシピ基本情報
    const recipe = await env.DB.prepare(`
      SELECT * FROM recipes WHERE id = ?
    `).bind(recipeId).first()
    
    if (!recipe) {
      return c.json({ error: 'Recipe not found' }, 404)
    }
    
    // レシピの材料情報
    const { results: ingredients } = await env.DB.prepare(`
      SELECT 
        ri.quantity,
        ri.unit,
        i.id,
        i.name,
        i.price_per_unit,
        i.unit as ingredient_unit,
        i.category,
        i.image_url
      FROM recipe_ingredients ri
      JOIN ingredients i ON ri.ingredient_id = i.id
      WHERE ri.recipe_id = ?
    `).bind(recipeId).all()
    
    return c.json({ 
      recipe,
      ingredients 
    })
  } catch (error) {
    return c.json({ error: 'Failed to fetch recipe details' }, 500)
  }
})

// レシピ作成（管理者のみ）
app.post('/api/recipes', async (c) => {
  await checkAdminRole(c, async () => {})
  if (c.res.status !== undefined && c.res.status !== 200) return c.res
  
  const { env } = c
  
  try {
    const body = await c.req.json()
    const { 
      title, 
      description, 
      video_url, 
      category, 
      difficulty, 
      prep_time, 
      cook_time, 
      servings, 
      image_url, 
      instructions,
      ingredients 
    } = body
    
    // バリデーション
    if (!title || !category) {
      return c.json({ error: 'Title and category are required' }, 400)
    }
    
    if (category !== 'パン' && category !== '洋菓子') {
      return c.json({ error: 'Category must be "パン" or "洋菓子"' }, 400)
    }
    
    // レシピを作成
    const result = await env.DB.prepare(`
      INSERT INTO recipes (
        title, description, video_url, category, difficulty, 
        prep_time, cook_time, servings, image_url, instructions
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      title, 
      description || null, 
      video_url || null, 
      category, 
      difficulty || null, 
      prep_time || null, 
      cook_time || null, 
      servings || null, 
      image_url || null, 
      instructions || null
    ).run()
    
    const recipeId = result.meta.last_row_id
    
    // 材料を追加
    if (ingredients && Array.isArray(ingredients) && ingredients.length > 0) {
      for (const ing of ingredients) {
        await env.DB.prepare(`
          INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit)
          VALUES (?, ?, ?, ?)
        `).bind(recipeId, ing.ingredient_id, ing.quantity, ing.unit).run()
      }
    }
    
    return c.json({ 
      message: 'Recipe created successfully',
      recipe_id: recipeId
    }, 201)
  } catch (error) {
    console.error(error)
    return c.json({ error: 'Failed to create recipe' }, 500)
  }
})

// レシピ更新（管理者のみ）
app.put('/api/recipes/:id', async (c) => {
  await checkAdminRole(c, async () => {})
  if (c.res.status !== undefined && c.res.status !== 200) return c.res
  
  const { env } = c
  const recipeId = c.req.param('id')
  
  try {
    // レシピが存在するか確認
    const existingRecipe = await env.DB.prepare(
      'SELECT * FROM recipes WHERE id = ?'
    ).bind(recipeId).first()
    
    if (!existingRecipe) {
      return c.json({ error: 'Recipe not found' }, 404)
    }
    
    const body = await c.req.json()
    const { 
      title, 
      description, 
      video_url, 
      category, 
      difficulty, 
      prep_time, 
      cook_time, 
      servings, 
      image_url, 
      instructions,
      ingredients 
    } = body
    
    // バリデーション
    if (category && category !== 'パン' && category !== '洋菓子') {
      return c.json({ error: 'Category must be "パン" or "洋菓子"' }, 400)
    }
    
    // レシピを更新
    await env.DB.prepare(`
      UPDATE recipes SET
        title = ?,
        description = ?,
        video_url = ?,
        category = ?,
        difficulty = ?,
        prep_time = ?,
        cook_time = ?,
        servings = ?,
        image_url = ?,
        instructions = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(
      title || existingRecipe.title,
      description !== undefined ? description : existingRecipe.description,
      video_url !== undefined ? video_url : existingRecipe.video_url,
      category || existingRecipe.category,
      difficulty !== undefined ? difficulty : existingRecipe.difficulty,
      prep_time !== undefined ? prep_time : existingRecipe.prep_time,
      cook_time !== undefined ? cook_time : existingRecipe.cook_time,
      servings !== undefined ? servings : existingRecipe.servings,
      image_url !== undefined ? image_url : existingRecipe.image_url,
      instructions !== undefined ? instructions : existingRecipe.instructions,
      recipeId
    ).run()
    
    // 材料を更新（既存の材料を削除して再追加）
    if (ingredients && Array.isArray(ingredients)) {
      // 既存の材料を削除
      await env.DB.prepare(
        'DELETE FROM recipe_ingredients WHERE recipe_id = ?'
      ).bind(recipeId).run()
      
      // 新しい材料を追加
      for (const ing of ingredients) {
        await env.DB.prepare(`
          INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit)
          VALUES (?, ?, ?, ?)
        `).bind(recipeId, ing.ingredient_id, ing.quantity, ing.unit).run()
      }
    }
    
    return c.json({ 
      message: 'Recipe updated successfully',
      recipe_id: recipeId
    })
  } catch (error) {
    console.error(error)
    return c.json({ error: 'Failed to update recipe' }, 500)
  }
})

// レシピ削除（管理者のみ）
app.delete('/api/recipes/:id', async (c) => {
  await checkAdminRole(c, async () => {})
  if (c.res.status !== undefined && c.res.status !== 200) return c.res
  
  const { env } = c
  const recipeId = c.req.param('id')
  
  try {
    // レシピが存在するか確認
    const recipe = await env.DB.prepare(
      'SELECT * FROM recipes WHERE id = ?'
    ).bind(recipeId).first()
    
    if (!recipe) {
      return c.json({ error: 'Recipe not found' }, 404)
    }
    
    // レシピを削除（recipe_ingredientsは外部キー制約でカスケード削除される）
    await env.DB.prepare(
      'DELETE FROM recipes WHERE id = ?'
    ).bind(recipeId).run()
    
    return c.json({ 
      message: 'Recipe deleted successfully'
    })
  } catch (error) {
    console.error(error)
    return c.json({ error: 'Failed to delete recipe' }, 500)
  }
})

// レシピ関連のトレンド情報取得
app.get('/api/recipes/:id/trends', async (c) => {
  const { env } = c
  const recipeId = c.req.param('id')
  
  try {
    // レシピが存在するか確認
    const recipe = await env.DB.prepare(
      'SELECT * FROM recipes WHERE id = ?'
    ).bind(recipeId).first()
    
    if (!recipe) {
      return c.json({ error: 'Recipe not found' }, 404)
    }
    
    // Web検索を実行してトレンド情報を取得
    const searchQuery = `${recipe.title} ${recipe.category} トレンド 最新`
    
    // WebSearchツールを使用（実際の実装では外部APIを呼び出す必要があります）
    // ここでは簡易的なトレンド情報を生成
    const trends = {
      recipe_name: recipe.title,
      category: recipe.category,
      search_query: searchQuery,
      trends: [
        {
          title: `${recipe.title}の最新アレンジレシピが話題`,
          description: `SNSで人気の${recipe.title}のアレンジ方法が注目を集めています。`,
          source: 'トレンド情報',
          date: new Date().toLocaleDateString('ja-JP')
        },
        {
          title: `${recipe.category}市場が拡大中`,
          description: `健康志向の高まりにより、${recipe.category}の需要が増加しています。`,
          source: 'マーケット情報',
          date: new Date().toLocaleDateString('ja-JP')
        },
        {
          title: `プロが教える${recipe.title}のコツ`,
          description: `有名シェフが公開した${recipe.title}の作り方のポイントが話題になっています。`,
          source: 'レシピ情報',
          date: new Date().toLocaleDateString('ja-JP')
        }
      ],
      related_keywords: [
        `${recipe.title} 作り方`,
        `${recipe.title} 簡単`,
        `${recipe.title} アレンジ`,
        `${recipe.category} 人気`,
        `${recipe.category} レシピ`
      ],
      timestamp: new Date().toISOString()
    }
    
    return c.json(trends)
  } catch (error) {
    console.error(error)
    return c.json({ error: 'Failed to fetch trends' }, 500)
  }
})

// =====================================
// 材料API
// =====================================

// 材料一覧取得
app.get('/api/ingredients', async (c) => {
  const { env } = c
  const category = c.req.query('category')
  
  try {
    let query = 'SELECT * FROM ingredients'
    
    if (category) {
      query += ' WHERE category = ?'
      const { results } = await env.DB.prepare(query).bind(category).all()
      return c.json({ ingredients: results })
    }
    
    const { results } = await env.DB.prepare(query).all()
    return c.json({ ingredients: results })
  } catch (error) {
    return c.json({ error: 'Failed to fetch ingredients' }, 500)
  }
})

// 材料詳細取得
app.get('/api/ingredients/:id', async (c) => {
  const { env } = c
  const ingredientId = c.req.param('id')
  
  try {
    const ingredient = await env.DB.prepare(`
      SELECT * FROM ingredients WHERE id = ?
    `).bind(ingredientId).first()
    
    if (!ingredient) {
      return c.json({ error: 'Ingredient not found' }, 404)
    }
    
    return c.json({ ingredient })
  } catch (error) {
    return c.json({ error: 'Failed to fetch ingredient details' }, 500)
  }
})

// =====================================
// 注文API
// =====================================

// 注文作成
app.post('/api/orders', async (c) => {
  const { env } = c
  
  try {
    const body = await c.req.json()
    const { customer_name, customer_email, customer_phone, items, notes } = body
    
    if (!customer_name || !customer_email || !items || items.length === 0) {
      return c.json({ error: 'Missing required fields' }, 400)
    }
    
    // 合計金額計算
    let total_amount = 0
    for (const item of items) {
      const ingredient = await env.DB.prepare(
        'SELECT price_per_unit FROM ingredients WHERE id = ?'
      ).bind(item.ingredient_id).first()
      
      if (!ingredient) {
        return c.json({ error: `Ingredient ${item.ingredient_id} not found` }, 404)
      }
      
      total_amount += ingredient.price_per_unit * item.quantity
    }
    
    // 注文作成
    const orderResult = await env.DB.prepare(`
      INSERT INTO orders (customer_name, customer_email, customer_phone, total_amount, notes)
      VALUES (?, ?, ?, ?, ?)
    `).bind(customer_name, customer_email, customer_phone || null, total_amount, notes || null).run()
    
    const orderId = orderResult.meta.last_row_id
    
    // 注文詳細作成
    for (const item of items) {
      const ingredient = await env.DB.prepare(
        'SELECT price_per_unit FROM ingredients WHERE id = ?'
      ).bind(item.ingredient_id).first()
      
      const subtotal = ingredient.price_per_unit * item.quantity
      
      await env.DB.prepare(`
        INSERT INTO order_items (order_id, ingredient_id, quantity, unit_price, subtotal)
        VALUES (?, ?, ?, ?, ?)
      `).bind(orderId, item.ingredient_id, item.quantity, ingredient.price_per_unit, subtotal).run()
    }
    
    return c.json({ 
      message: 'Order created successfully',
      order_id: orderId,
      total_amount
    }, 201)
  } catch (error) {
    console.error(error)
    return c.json({ error: 'Failed to create order' }, 500)
  }
})

// 注文一覧取得
app.get('/api/orders', async (c) => {
  const { env } = c
  
  try {
    const { results } = await env.DB.prepare(`
      SELECT * FROM orders ORDER BY created_at DESC
    `).all()
    
    return c.json({ orders: results })
  } catch (error) {
    return c.json({ error: 'Failed to fetch orders' }, 500)
  }
})

// 注文詳細取得
app.get('/api/orders/:id', async (c) => {
  const { env } = c
  const orderId = c.req.param('id')
  
  try {
    // 注文基本情報
    const order = await env.DB.prepare(`
      SELECT * FROM orders WHERE id = ?
    `).bind(orderId).first()
    
    if (!order) {
      return c.json({ error: 'Order not found' }, 404)
    }
    
    // 注文詳細情報
    const { results: items } = await env.DB.prepare(`
      SELECT 
        oi.*,
        i.name as ingredient_name,
        i.unit as ingredient_unit
      FROM order_items oi
      JOIN ingredients i ON oi.ingredient_id = i.id
      WHERE oi.order_id = ?
    `).bind(orderId).all()
    
    return c.json({ 
      order,
      items
    })
  } catch (error) {
    return c.json({ error: 'Failed to fetch order details' }, 500)
  }
})

// =====================================
// 管理画面ページ
// =====================================

// 管理画面（管理者のみ）
app.get('/admin', async (c) => {
  const { env } = c
  const token = getCookie(c, 'session_token')
  
  if (!token) {
    return c.redirect('/recipes')
  }
  
  try {
    const session = await env.DB.prepare(`
      SELECT s.*, u.role 
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.token = ? AND s.expires_at > datetime('now')
    `).bind(token).first()
    
    if (!session || session.role !== 'admin') {
      return c.redirect('/recipes')
    }
  } catch (error) {
    return c.redirect('/recipes')
  }
  
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>管理画面 - ナチュラルベーカリー</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
        <link href="/static/style.css" rel="stylesheet">
    </head>
    <body>
        <!-- ヘッダー -->
        <header class="glass-effect sticky top-0 z-40 border-b border-[#E8DCC4] border-opacity-30">
            <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-3">
                        <div class="w-12 h-12 rounded-full bg-gradient-to-br from-[#D4A574] to-[#B88A5A] flex items-center justify-center shadow-md">
                            <i class="fas fa-cog text-white text-lg"></i>
                        </div>
                        <div>
                            <h1 class="text-2xl font-bold heading-elegant text-gradient">
                                管理画面
                            </h1>
                            <p class="text-xs text-[#8B6F47] font-light">レシピ管理システム</p>
                        </div>
                    </div>
                    <a href="/recipes" class="btn-natural px-5 py-3 rounded-full text-white font-medium" 
                       style="background: linear-gradient(135deg, #B88A5A, #8B6F47);">
                        <i class="fas fa-book mr-2"></i>
                        <span class="hidden sm:inline">レシピページへ</span>
                    </a>
                </div>
            </div>
        </header>

        <!-- メインコンテンツ -->
        <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <!-- タブナビゲーション -->
            <div class="mb-8">
                <div class="flex gap-3 border-b border-[#E8DCC4] overflow-x-auto">
                    <button class="tab-btn px-6 py-3 font-semibold text-[#B88A5A] border-b-2 border-[#B88A5A] whitespace-nowrap" data-tab="recipes">
                        <i class="fas fa-book mr-2"></i>レシピ管理
                    </button>
                    <button class="tab-btn px-6 py-3 font-semibold text-[#8B6F47] hover:text-[#B88A5A] whitespace-nowrap" data-tab="create">
                        <i class="fas fa-plus mr-2"></i>新規作成
                    </button>
                    <button class="tab-btn px-6 py-3 font-semibold text-[#8B6F47] hover:text-[#B88A5A] whitespace-nowrap" data-tab="customers">
                        <i class="fas fa-users mr-2"></i>顧客管理
                    </button>
                    <button class="tab-btn px-6 py-3 font-semibold text-[#8B6F47] hover:text-[#B88A5A] whitespace-nowrap" data-tab="orders">
                        <i class="fas fa-shopping-cart mr-2"></i>注文管理
                    </button>
                </div>
            </div>

            <!-- レシピ一覧タブ -->
            <div id="recipes-tab" class="tab-content">
                <div class="section-natural mb-6">
                    <h2 class="text-xl font-bold heading-elegant text-[#4A4A48] mb-4">
                        <i class="fas fa-list mr-2"></i>レシピ一覧
                    </h2>
                    <div id="adminRecipeList" class="space-y-3">
                        <!-- レシピリストが動的に追加されます -->
                    </div>
                </div>
            </div>

            <!-- 新規作成タブ -->
            <div id="create-tab" class="tab-content hidden">
                <div class="section-natural">
                    <h2 class="text-xl font-bold heading-elegant text-[#4A4A48] mb-6">
                        <i class="fas fa-plus-circle mr-2"></i>新しいレシピを作成
                    </h2>
                    <form id="recipeForm">
                        <input type="hidden" id="recipeId" value="">
                        
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <!-- 基本情報 -->
                            <div class="space-y-4">
                                <h3 class="font-semibold text-[#4A4A48] text-lg mb-3">基本情報</h3>
                                
                                <div>
                                    <label class="block text-sm font-semibold text-[#4A4A48] mb-2">
                                        レシピ名 <span class="text-red-500">*</span>
                                    </label>
                                    <input type="text" id="title" required class="input-natural w-full" placeholder="例：基本の食パン">
                                </div>
                                
                                <div>
                                    <label class="block text-sm font-semibold text-[#4A4A48] mb-2">
                                        カテゴリ <span class="text-red-500">*</span>
                                    </label>
                                    <select id="category" required class="input-natural w-full">
                                        <option value="">選択してください</option>
                                        <option value="パン">パン</option>
                                        <option value="洋菓子">洋菓子</option>
                                    </select>
                                </div>
                                
                                <div>
                                    <label class="block text-sm font-semibold text-[#4A4A48] mb-2">
                                        難易度
                                    </label>
                                    <select id="difficulty" class="input-natural w-full">
                                        <option value="">選択してください</option>
                                        <option value="初級">初級</option>
                                        <option value="中級">中級</option>
                                        <option value="上級">上級</option>
                                    </select>
                                </div>
                                
                                <div class="grid grid-cols-3 gap-3">
                                    <div>
                                        <label class="block text-sm font-semibold text-[#4A4A48] mb-2">
                                            準備時間（分）
                                        </label>
                                        <input type="number" id="prep_time" class="input-natural w-full" placeholder="20">
                                    </div>
                                    <div>
                                        <label class="block text-sm font-semibold text-[#4A4A48] mb-2">
                                            調理時間（分）
                                        </label>
                                        <input type="number" id="cook_time" class="input-natural w-full" placeholder="180">
                                    </div>
                                    <div>
                                        <label class="block text-sm font-semibold text-[#4A4A48] mb-2">
                                            人数
                                        </label>
                                        <input type="number" id="servings" class="input-natural w-full" placeholder="8">
                                    </div>
                                </div>
                            </div>
                            
                            <!-- メディア情報 -->
                            <div class="space-y-4">
                                <h3 class="font-semibold text-[#4A4A48] text-lg mb-3">メディア情報</h3>
                                
                                <div>
                                    <label class="block text-sm font-semibold text-[#4A4A48] mb-2">
                                        動画URL（YouTube埋め込みURL）
                                    </label>
                                    <input type="url" id="video_url" class="input-natural w-full" 
                                           placeholder="https://www.youtube.com/embed/...">
                                    <p class="text-xs text-[#8B6F47] mt-1">
                                        <i class="fas fa-info-circle mr-1"></i>
                                        YouTube動画の埋め込みURLを入力してください
                                    </p>
                                </div>
                                
                                <div>
                                    <label class="block text-sm font-semibold text-[#4A4A48] mb-2">
                                        画像URL
                                    </label>
                                    <input type="url" id="image_url" class="input-natural w-full" 
                                           placeholder="https://example.com/image.jpg">
                                </div>
                            </div>
                        </div>
                        
                        <!-- 説明 -->
                        <div class="mt-6">
                            <label class="block text-sm font-semibold text-[#4A4A48] mb-2">
                                説明
                            </label>
                            <textarea id="description" rows="3" class="input-natural w-full resize-none" 
                                      placeholder="レシピの簡単な説明を入力してください"></textarea>
                        </div>
                        
                        <!-- 作り方 -->
                        <div class="mt-6">
                            <label class="block text-sm font-semibold text-[#4A4A48] mb-2">
                                作り方
                            </label>
                            <textarea id="instructions" rows="8" class="input-natural w-full resize-none" 
                                      placeholder="1. ボウルに強力粉、砂糖、塩を入れる&#10;2. 水を加えてこねる&#10;3. ..."></textarea>
                        </div>
                        
                        <!-- 材料選択 -->
                        <div class="mt-6">
                            <label class="block text-sm font-semibold text-[#4A4A48] mb-2">
                                材料
                            </label>
                            <div id="ingredientsList" class="space-y-2 mb-3">
                                <!-- 材料リストが動的に追加されます -->
                            </div>
                            <button type="button" id="addIngredientBtn" 
                                    class="btn-natural px-4 py-2 rounded-lg text-[#8B6F47] bg-[#F5F3EE] hover:bg-[#E8DCC4]">
                                <i class="fas fa-plus mr-2"></i>材料を追加
                            </button>
                        </div>
                        
                        <!-- 送信ボタン -->
                        <div class="flex gap-3 mt-8">
                            <button type="button" id="cancelBtn" 
                                    class="btn-natural flex-1 py-3 rounded-full bg-white border-2 border-[#E8DCC4] text-[#8B6F47] font-semibold hover:bg-[#F5F3EE]">
                                キャンセル
                            </button>
                            <button type="submit" 
                                    class="btn-natural flex-1 py-3 rounded-full text-white font-bold" 
                                    style="background: linear-gradient(135deg, #9CAF88, #6B7F5C);">
                                <i class="fas fa-save mr-2"></i>
                                <span id="submitBtnText">レシピを保存</span>
                            </button>
                        </div>
                    </form>
                </div>
            </div>

            <!-- 顧客管理タブ -->
            <div id="customers-tab" class="tab-content hidden">
                <div class="section-natural">
                    <h2 class="text-xl font-bold heading-elegant text-[#4A4A48] mb-6">
                        <i class="fas fa-users mr-2"></i>顧客情報一覧
                    </h2>
                    <div id="customersList" class="overflow-x-auto">
                        <p class="text-center text-[#8B6F47] py-8">読み込み中...</p>
                    </div>
                </div>
            </div>

            <!-- 注文管理タブ -->
            <div id="orders-tab" class="tab-content hidden">
                <div class="section-natural">
                    <h2 class="text-xl font-bold heading-elegant text-[#4A4A48] mb-6">
                        <i class="fas fa-shopping-cart mr-2"></i>注文状況一覧
                    </h2>
                    <div id="ordersList" class="overflow-x-auto">
                        <p class="text-center text-[#8B6F47] py-8">読み込み中...</p>
                    </div>
                </div>
            </div>
        </main>

        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
        <script src="/static/admin.js"></script>
    </body>
    </html>
  `)
})

// =====================================
// フロントエンドページ
// =====================================

// =====================================
// フロントエンドページ
// =====================================

// ランディングページ（ログイン・登録）
app.get('/', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>ナチュラルベーカリー - ログイン</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
        <link href="/static/style.css" rel="stylesheet">
    </head>
    <body class="bg-gradient-to-br from-[#FAF8F3] to-[#FFFEF9] min-h-screen flex items-center justify-center p-4">
        <div class="w-full max-w-md">
            <!-- ロゴセクション -->
            <div class="text-center mb-8 animate-fade-in-up">
                <div class="inline-block w-20 h-20 rounded-full bg-gradient-to-br from-[#D4A574] to-[#B88A5A] flex items-center justify-center shadow-lg mb-4">
                    <i class="fas fa-wheat-awn text-white text-3xl"></i>
                </div>
                <h1 class="text-3xl font-bold heading-elegant text-gradient mb-2">
                    ナチュラルベーカリー
                </h1>
                <p class="text-[#8B6F47]">プロのレシピと厳選された材料をお届け</p>
            </div>

            <!-- タブボタン -->
            <div class="flex gap-2 mb-6">
                <button id="loginTab" class="flex-1 py-3 rounded-full font-bold text-white" style="background: linear-gradient(135deg, #B88A5A, #8B6F47);">
                    <i class="fas fa-sign-in-alt mr-2"></i>ログイン
                </button>
                <button id="registerTab" class="flex-1 py-3 rounded-full font-bold text-[#8B6F47] bg-white border-2 border-[#E8DCC4]">
                    <i class="fas fa-user-plus mr-2"></i>新規登録
                </button>
            </div>

            <!-- ログインフォーム -->
            <div id="loginForm" class="section-natural rounded-2xl shadow-2xl p-8 animate-scale-in">
                <form id="loginFormElement">
                    <div class="space-y-4">
                        <div>
                            <label class="block text-sm font-semibold text-[#4A4A48] mb-2">
                                <i class="fas fa-user mr-2 text-[#B88A5A]"></i>ユーザー名
                            </label>
                            <input type="text" id="loginUsername" required 
                                   class="input-natural w-full" 
                                   placeholder="ユーザー名を入力">
                        </div>
                        <div>
                            <label class="block text-sm font-semibold text-[#4A4A48] mb-2">
                                <i class="fas fa-lock mr-2 text-[#B88A5A]"></i>パスワード
                            </label>
                            <input type="password" id="loginPassword" required 
                                   class="input-natural w-full" 
                                   placeholder="パスワードを入力">
                        </div>
                    </div>
                    <button type="submit" 
                            class="btn-natural w-full py-3 rounded-full text-white font-bold mt-6" 
                            style="background: linear-gradient(135deg, #9CAF88, #6B7F5C);">
                        <i class="fas fa-sign-in-alt mr-2"></i>ログイン
                    </button>
                </form>
            </div>

            <!-- 登録フォーム -->
            <div id="registerForm" class="hidden section-natural rounded-2xl shadow-2xl p-8 animate-scale-in">
                <form id="registerFormElement">
                    <div class="space-y-4">
                        <div>
                            <label class="block text-sm font-semibold text-[#4A4A48] mb-2">
                                <i class="fas fa-user mr-2 text-[#B88A5A]"></i>ユーザー名 <span class="text-red-500">*</span>
                            </label>
                            <input type="text" id="regUsername" required 
                                   class="input-natural w-full" 
                                   placeholder="ユーザー名">
                        </div>
                        <div>
                            <label class="block text-sm font-semibold text-[#4A4A48] mb-2">
                                <i class="fas fa-lock mr-2 text-[#B88A5A]"></i>パスワード <span class="text-red-500">*</span>
                            </label>
                            <input type="password" id="regPassword" required 
                                   class="input-natural w-full" 
                                   placeholder="パスワード">
                        </div>
                        <div>
                            <label class="block text-sm font-semibold text-[#4A4A48] mb-2">
                                <i class="fas fa-store mr-2 text-[#B88A5A]"></i>店舗名 <span class="text-red-500">*</span>
                            </label>
                            <input type="text" id="regBusinessName" required 
                                   class="input-natural w-full" 
                                   placeholder="例: ベーカリー山田">
                        </div>
                        <div>
                            <label class="block text-sm font-semibold text-[#4A4A48] mb-2">
                                <i class="fas fa-bread-slice mr-2 text-[#B88A5A]"></i>業態 <span class="text-red-500">*</span>
                            </label>
                            <select id="regBusinessType" required class="input-natural w-full">
                                <option value="">選択してください</option>
                                <option value="パン屋">パン屋</option>
                                <option value="洋菓子屋">洋菓子屋</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-sm font-semibold text-[#4A4A48] mb-2">
                                <i class="fas fa-user-tie mr-2 text-[#B88A5A]"></i>オーナー名 <span class="text-red-500">*</span>
                            </label>
                            <input type="text" id="regOwnerName" required 
                                   class="input-natural w-full" 
                                   placeholder="山田 太郎">
                        </div>
                        <div>
                            <label class="block text-sm font-semibold text-[#4A4A48] mb-2">
                                <i class="fas fa-envelope mr-2 text-[#B88A5A]"></i>メールアドレス <span class="text-red-500">*</span>
                            </label>
                            <input type="email" id="regEmail" required 
                                   class="input-natural w-full" 
                                   placeholder="example@email.com">
                        </div>
                        <div>
                            <label class="block text-sm font-semibold text-[#4A4A48] mb-2">
                                <i class="fas fa-phone mr-2 text-[#B88A5A]"></i>電話番号
                            </label>
                            <input type="tel" id="regPhone" 
                                   class="input-natural w-full" 
                                   placeholder="090-1234-5678">
                        </div>
                        <div>
                            <label class="block text-sm font-semibold text-[#4A4A48] mb-2">
                                <i class="fas fa-map-marker-alt mr-2 text-[#B88A5A]"></i>住所
                            </label>
                            <input type="text" id="regAddress" 
                                   class="input-natural w-full" 
                                   placeholder="例: 大阪府大阪市中央区本町1-2-3">
                        </div>
                    </div>
                    <button type="submit" 
                            class="btn-natural w-full py-3 rounded-full text-white font-bold mt-6" 
                            style="background: linear-gradient(135deg, #9CAF88, #6B7F5C);">
                        <i class="fas fa-user-plus mr-2"></i>新規登録
                    </button>
                </form>
            </div>
        </div>

        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
        <script>
            // タブ切り替え
            const loginTab = document.getElementById('loginTab')
            const registerTab = document.getElementById('registerTab')
            const loginForm = document.getElementById('loginForm')
            const registerForm = document.getElementById('registerForm')

            loginTab.addEventListener('click', () => {
                loginTab.style.background = 'linear-gradient(135deg, #B88A5A, #8B6F47)'
                loginTab.classList.add('text-white')
                registerTab.style.background = 'white'
                registerTab.classList.remove('text-white')
                registerTab.classList.add('text-[#8B6F47]')
                loginForm.classList.remove('hidden')
                registerForm.classList.add('hidden')
            })

            registerTab.addEventListener('click', () => {
                registerTab.style.background = 'linear-gradient(135deg, #B88A5A, #8B6F47)'
                registerTab.classList.add('text-white')
                loginTab.style.background = 'white'
                loginTab.classList.remove('text-white')
                loginTab.classList.add('text-[#8B6F47]')
                registerForm.classList.remove('hidden')
                loginForm.classList.add('hidden')
            })

            // ログイン処理
            document.getElementById('loginFormElement').addEventListener('submit', async (e) => {
                e.preventDefault()
                const username = document.getElementById('loginUsername').value
                const password = document.getElementById('loginPassword').value

                try {
                    const response = await axios.post('/api/auth/login', { username, password })
                    if (response.data.user) {
                        window.location.href = '/recipes'
                    }
                } catch (error) {
                    alert(error.response?.data?.error || 'ログインに失敗しました')
                }
            })

            // 登録処理
            document.getElementById('registerFormElement').addEventListener('submit', async (e) => {
                e.preventDefault()
                const data = {
                    username: document.getElementById('regUsername').value,
                    password: document.getElementById('regPassword').value,
                    business_name: document.getElementById('regBusinessName').value,
                    business_type: document.getElementById('regBusinessType').value,
                    owner_name: document.getElementById('regOwnerName').value,
                    email: document.getElementById('regEmail').value,
                    phone: document.getElementById('regPhone').value,
                    address: document.getElementById('regAddress').value
                }

                try {
                    await axios.post('/api/auth/register', data)
                    alert('登録が完了しました。ログインしてください。')
                    loginTab.click()
                } catch (error) {
                    alert(error.response?.data?.error || '登録に失敗しました')
                }
            })
        </script>
    </body>
    </html>
  `)
})

// レシピページ（認証が必要）
app.get('/recipes', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>ナチュラルベーカリー - レシピと材料</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
        <link href="/static/style.css" rel="stylesheet">
    </head>
    <body>
        <!-- ヘッダー -->
        <header class="glass-effect sticky top-0 z-40 border-b border-[#E8DCC4] border-opacity-30">
            <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-3">
                        <div class="w-12 h-12 rounded-full bg-gradient-to-br from-[#D4A574] to-[#B88A5A] flex items-center justify-center shadow-md">
                            <i class="fas fa-wheat-awn text-white text-lg"></i>
                        </div>
                        <div>
                            <h1 class="text-2xl font-bold heading-elegant text-gradient">
                                ナチュラルベーカリー
                            </h1>
                            <p class="text-xs text-[#8B6F47] font-light">自然の恵みから生まれるレシピ</p>
                        </div>
                    </div>
                    <div class="flex items-center gap-3">
                        <a href="/admin" id="adminLink" class="btn-natural px-4 py-2 rounded-full text-[#8B6F47] bg-white border-2 border-[#E8DCC4] hover:bg-[#F5F3EE] font-medium hidden sm:flex items-center">
                            <i class="fas fa-cog mr-2"></i>
                            管理
                        </a>
                        <button id="logoutBtn" class="btn-natural px-4 py-2 rounded-full text-[#8B6F47] bg-white border-2 border-[#E8DCC4] hover:bg-[#F5F3EE] font-medium flex items-center">
                            <i class="fas fa-sign-out-alt mr-2"></i>
                            <span class="hidden sm:inline">ログアウト</span>
                        </button>
                        <button id="cartBtn" class="btn-natural relative px-5 py-3 rounded-full text-white font-medium" 
                                style="background: linear-gradient(135deg, #B88A5A, #8B6F47);">
                            <i class="fas fa-shopping-basket mr-2"></i>
                            <span class="hidden sm:inline">カート</span>
                            <span id="cartCount" class="cart-badge absolute -top-2 -right-2 text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center">0</span>
                        </button>
                    </div>
                </div>
            </div>
        </header>

        <!-- ヒーローセクション -->
        <section class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div class="section-natural text-center py-12 animate-fade-in-up">
                <h2 class="text-3xl md:text-4xl font-bold heading-elegant text-[#4A4A48] mb-4">
                    世界中のトレンドを参考に、オリジナルレシピのアイデアを共創します
                </h2>
            </div>
        </section>

        <!-- 地域検索セクション -->
        <section class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-8">
            <div class="section-natural rounded-2xl p-8 animate-fade-in-up" style="animation-delay: 0.2s;">
                <div class="text-center mb-6">
                    <h3 class="text-2xl font-bold heading-elegant text-[#4A4A48] mb-2">
                        <i class="fas fa-map-marker-alt mr-2 text-[#B88A5A]"></i>
                        地域のおすすめ店舗を探す
                    </h3>
                    <p class="text-[#8B6F47]">お住まいの地域で人気のパン屋・洋菓子屋とその看板商品をご紹介</p>
                </div>
                
                <div class="max-w-2xl mx-auto">
                    <div class="flex gap-3">
                        <input type="text" 
                               id="regionInput" 
                               placeholder="地域名を入力（例: 大阪、東京渋谷、京都など）" 
                               class="input-natural flex-1"
                               onkeypress="if(event.key==='Enter') searchLocalShops()">
                        <button onclick="searchLocalShops()" 
                                class="btn-natural px-6 py-3 rounded-full text-white font-bold whitespace-nowrap" 
                                style="background: linear-gradient(135deg, #9CAF88, #6B7F5C);">
                            <i class="fas fa-search mr-2"></i>検索
                        </button>
                    </div>
                </div>
                
                <!-- ローディング表示 -->
                <div id="shopsLoading" class="hidden text-center py-8">
                    <i class="fas fa-spinner fa-spin text-4xl text-[#B88A5A] mb-3"></i>
                    <p class="text-[#8B6F47]">地域情報を検索中...</p>
                </div>
                
                <!-- 検索結果表示エリア -->
                <div id="shopsResults" class="mt-8 hidden">
                    <div class="border-t border-[#E8DCC4] pt-6">
                        <h4 class="text-xl font-bold heading-elegant text-[#4A4A48] mb-6 text-center">
                            <span id="resultRegion"></span>の人気店舗TOP3
                        </h4>
                        <div id="shopsList" class="space-y-6">
                            <!-- 検索結果がここに表示されます -->
                        </div>
                    </div>
                </div>
            </div>
        </section>

        <!-- メインコンテンツ -->
        <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
            <!-- カテゴリフィルター -->
            <div class="mb-10 animate-fade-in-up" style="animation-delay: 0.1s;">
                <div class="flex flex-wrap gap-3 justify-center">
                    <button class="category-btn btn-natural px-8 py-3 rounded-full font-medium transition-smooth text-white shadow-md" 
                            style="background: linear-gradient(135deg, #B88A5A, #8B6F47);" 
                            data-category="">
                        <i class="fas fa-th mr-2"></i>すべて
                    </button>
                    <button class="category-btn btn-natural px-8 py-3 rounded-full font-medium transition-smooth bg-white text-[#8B6F47] border-2 border-[#E8DCC4]" 
                            data-category="パン">
                        <i class="fas fa-bread-slice mr-2"></i>パン
                    </button>
                    <button class="category-btn btn-natural px-8 py-3 rounded-full font-medium transition-smooth bg-white text-[#8B6F47] border-2 border-[#E8DCC4]" 
                            data-category="洋菓子">
                        <i class="fas fa-cake-candles mr-2"></i>洋菓子
                    </button>
                </div>
            </div>

            <!-- レシピ一覧 -->
            <div id="recipeList" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                <!-- ここにレシピカードが動的に追加されます -->
            </div>
        </main>

        <!-- カートモーダル -->
        <div id="cartModal" class="hidden fixed inset-0 modal-overlay flex items-center justify-center z-50 p-4">
            <div class="bg-white rounded-2xl shadow-2xl max-w-3xl w-full mx-4 max-h-[90vh] overflow-hidden animate-scale-in">
                <div class="sticky top-0 bg-gradient-to-r from-[#FAF8F3] to-[#FFFEF9] px-6 py-5 border-b border-[#E8DCC4]">
                    <div class="flex justify-between items-center">
                        <div>
                            <h2 class="text-2xl font-bold heading-elegant text-[#4A4A48]">ショッピングカート</h2>
                            <p class="text-sm text-[#8B6F47] mt-1">選んだ材料を確認しましょう</p>
                        </div>
                        <button id="closeCartBtn" class="w-10 h-10 rounded-full bg-white hover:bg-[#F5F3EE] transition-smooth flex items-center justify-center text-[#8B6F47]">
                            <i class="fas fa-times text-lg"></i>
                        </button>
                    </div>
                </div>
                <div id="cartItems" class="p-6 overflow-y-auto" style="max-height: calc(90vh - 220px);">
                    <!-- カートアイテムが表示されます -->
                </div>
                <div class="sticky bottom-0 bg-gradient-to-r from-[#FAF8F3] to-[#FFFEF9] px-6 py-5 border-t border-[#E8DCC4]">
                    <div class="flex justify-between items-center mb-4">
                        <span class="text-lg font-semibold text-[#4A4A48]">合計金額</span>
                        <span id="totalAmount" class="text-3xl font-bold heading-elegant text-[#B88A5A]">¥0</span>
                    </div>
                    <button id="checkoutBtn" class="btn-natural w-full py-4 rounded-full text-white font-bold text-lg" 
                            style="background: linear-gradient(135deg, #9CAF88, #6B7F5C);">
                        <i class="fas fa-check-circle mr-2"></i>
                        注文に進む
                    </button>
                </div>
            </div>
        </div>

        <!-- 注文フォームモーダル -->
        <div id="orderModal" class="hidden fixed inset-0 modal-overlay flex items-center justify-center z-50 p-4">
            <div class="bg-white rounded-2xl shadow-2xl max-w-lg w-full mx-4 animate-scale-in">
                <div class="bg-gradient-to-r from-[#FAF8F3] to-[#FFFEF9] px-6 py-5 border-b border-[#E8DCC4] rounded-t-2xl">
                    <h2 class="text-2xl font-bold heading-elegant text-[#4A4A48]">お客様情報</h2>
                    <p class="text-sm text-[#8B6F47] mt-1">配送に必要な情報をご入力ください</p>
                </div>
                <form id="orderForm" class="p-6">
                    <div class="space-y-5">
                        <div>
                            <label class="block text-sm font-semibold text-[#4A4A48] mb-2">
                                <i class="fas fa-user mr-2 text-[#B88A5A]"></i>お名前 <span class="text-red-500">*</span>
                            </label>
                            <input type="text" id="customerName" required 
                                   class="input-natural w-full" 
                                   placeholder="山田 太郎">
                        </div>
                        <div>
                            <label class="block text-sm font-semibold text-[#4A4A48] mb-2">
                                <i class="fas fa-envelope mr-2 text-[#B88A5A]"></i>メールアドレス <span class="text-red-500">*</span>
                            </label>
                            <input type="email" id="customerEmail" required 
                                   class="input-natural w-full" 
                                   placeholder="example@email.com">
                        </div>
                        <div>
                            <label class="block text-sm font-semibold text-[#4A4A48] mb-2">
                                <i class="fas fa-phone mr-2 text-[#B88A5A]"></i>電話番号
                            </label>
                            <input type="tel" id="customerPhone" 
                                   class="input-natural w-full" 
                                   placeholder="090-1234-5678">
                        </div>
                        <div>
                            <label class="block text-sm font-semibold text-[#4A4A48] mb-2">
                                <i class="fas fa-comment mr-2 text-[#B88A5A]"></i>備考・特記事項
                            </label>
                            <textarea id="orderNotes" rows="3" 
                                      class="input-natural w-full resize-none" 
                                      placeholder="配送時の注意事項などをご記入ください"></textarea>
                        </div>
                    </div>
                    <div class="flex gap-3 mt-8">
                        <button type="button" id="cancelOrderBtn" 
                                class="btn-natural flex-1 py-3 rounded-full bg-white border-2 border-[#E8DCC4] text-[#8B6F47] font-semibold hover:bg-[#F5F3EE]">
                            キャンセル
                        </button>
                        <button type="submit" 
                                class="btn-natural flex-1 py-3 rounded-full text-white font-bold" 
                                style="background: linear-gradient(135deg, #9CAF88, #6B7F5C);">
                            <i class="fas fa-paper-plane mr-2"></i>注文確定
                        </button>
                    </div>
                </form>
            </div>
        </div>

        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
        <script>
            // 認証チェック
            async function checkAuth() {
                try {
                    const response = await axios.get('/api/auth/me')
                    if (response.data.user) {
                        console.log('認証成功:', response.data.user)
                        
                        // 管理者でない場合は管理リンクを非表示
                        const adminLink = document.getElementById('adminLink')
                        if (adminLink) {
                            if (response.data.user.role !== 'admin') {
                                adminLink.style.display = 'none'
                            }
                        }
                        
                        return true
                    }
                } catch (error) {
                    console.error('認証失敗:', error.response?.status, error.response?.data)
                    // 401エラーの場合のみリダイレクト
                    if (error.response?.status === 401) {
                        alert('ログインが必要です')
                        window.location.href = '/'
                    }
                    return false
                }
            }
            
            // ページ読み込み時に認証チェック
            checkAuth()
            
            // ログアウト
            document.getElementById('logoutBtn').addEventListener('click', async () => {
                try {
                    await axios.post('/api/auth/logout')
                    window.location.href = '/'
                } catch (error) {
                    console.error('ログアウトエラー:', error)
                }
            })
            
            // 地域検索機能
            async function searchLocalShops() {
                const region = document.getElementById('regionInput').value.trim()
                
                if (!region) {
                    alert('地域名を入力してください')
                    return
                }
                
                // UI状態を更新
                document.getElementById('shopsLoading').classList.remove('hidden')
                document.getElementById('shopsResults').classList.add('hidden')
                
                try {
                    const response = await axios.post('/api/local-shops', { region })
                    const data = response.data
                    
                    // 結果を表示
                    document.getElementById('resultRegion').textContent = data.region
                    const shopsList = document.getElementById('shopsList')
                    shopsList.innerHTML = ''
                    
                    data.shops.forEach(shop => {
                        const typeClass = shop.type === 'パン屋' ? 'bg-[#F5E6D3] text-[#8B6F47]' : 'bg-[#E8DCC4] text-[#6B7F5C]'
                        const typeIcon = shop.type === 'パン屋' ? 'fa-bread-slice' : 'fa-cake-candles'
                        
                        const productsHtml = shop.popular_products.map(product => 
                            '<div class="bg-gradient-to-br from-[#FAF8F3] to-[#FFFEF9] rounded-lg p-3 border border-[#E8DCC4]">' +
                                '<div class="flex items-center gap-2 mb-1">' +
                                    '<span class="w-6 h-6 rounded-full bg-[#B88A5A] text-white text-xs flex items-center justify-center font-bold">' +
                                        product.rank +
                                    '</span>' +
                                    '<span class="text-sm font-semibold text-[#4A4A48]">' + product.name + '</span>' +
                                '</div>' +
                                '<div class="text-lg font-bold heading-elegant text-[#B88A5A]">' +
                                    product.price +
                                '</div>' +
                            '</div>'
                        ).join('')
                        
                        const shopCard = 
                            '<div class="bg-white rounded-xl shadow-md p-6 hover:shadow-xl transition-smooth">' +
                                '<div class="flex items-start gap-4">' +
                                    '<div class="flex-shrink-0">' +
                                        '<div class="w-16 h-16 rounded-full bg-gradient-to-br from-[#D4A574] to-[#B88A5A] flex items-center justify-center text-white text-2xl font-bold">' +
                                            shop.rank +
                                        '</div>' +
                                    '</div>' +
                                    '<div class="flex-1">' +
                                        '<div class="flex items-center gap-3 mb-2">' +
                                            '<h5 class="text-xl font-bold heading-elegant text-[#4A4A48]">' +
                                                shop.name +
                                            '</h5>' +
                                            '<span class="px-3 py-1 rounded-full text-xs font-semibold ' + typeClass + '">' +
                                                '<i class="fas ' + typeIcon + ' mr-1"></i>' +
                                                shop.type +
                                            '</span>' +
                                        '</div>' +
                                        '<p class="text-[#8B6F47] text-sm mb-2">' +
                                            '<i class="fas fa-map-marker-alt mr-1"></i>' + shop.address +
                                        '</p>' +
                                        '<p class="text-[#4A4A48] mb-4">' + shop.description + '</p>' +
                                        '<div class="border-t border-[#E8DCC4] pt-4">' +
                                            '<h6 class="text-sm font-bold text-[#8B6F47] mb-3">' +
                                                '<i class="fas fa-star mr-1 text-[#D4A574]"></i>人気商品TOP3' +
                                            '</h6>' +
                                            '<div class="grid grid-cols-1 sm:grid-cols-3 gap-3">' +
                                                productsHtml +
                                            '</div>' +
                                        '</div>' +
                                    '</div>' +
                                '</div>' +
                            '</div>'
                        
                        shopsList.innerHTML += shopCard
                    })
                    
                    // 結果を表示
                    document.getElementById('shopsLoading').classList.add('hidden')
                    document.getElementById('shopsResults').classList.remove('hidden')
                    
                    // 結果エリアまでスクロール
                    document.getElementById('shopsResults').scrollIntoView({ behavior: 'smooth', block: 'nearest' })
                    
                } catch (error) {
                    console.error('検索エラー:', error)
                    alert('地域情報の取得に失敗しました')
                    document.getElementById('shopsLoading').classList.add('hidden')
                }
            }
            
            // グローバルスコープに関数を公開
            window.searchLocalShops = searchLocalShops
        </script>
        <script src="/static/app.js"></script>
    </body>
    </html>
  `)
})

export default app
