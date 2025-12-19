import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'

type Bindings = {
  DB: D1Database;
}

const app = new Hono<{ Bindings: Bindings }>()

// CORS設定
app.use('/api/*', cors())

// 静的ファイル配信
app.use('/static/*', serveStatic({ root: './public' }))

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
// フロントエンドページ
// =====================================

app.get('/', (c) => {
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
                    <button id="cartBtn" class="btn-natural relative px-5 py-3 rounded-full text-white font-medium" 
                            style="background: linear-gradient(135deg, #B88A5A, #8B6F47);">
                        <i class="fas fa-shopping-basket mr-2"></i>
                        <span class="hidden sm:inline">カート</span>
                        <span id="cartCount" class="cart-badge absolute -top-2 -right-2 text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center">0</span>
                    </button>
                </div>
            </div>
        </header>

        <!-- ヒーローセクション -->
        <section class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div class="section-natural text-center py-12 animate-fade-in-up">
                <h2 class="text-3xl md:text-4xl font-bold heading-elegant text-[#4A4A48] mb-4">
                    手作りの喜びを、あなたのキッチンに
                </h2>
                <p class="text-[#8B6F47] text-lg max-w-2xl mx-auto">
                    プロのレシピと厳選された材料で、誰でも簡単に本格的なパン・洋菓子作りが楽しめます
                </p>
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
        <script src="/static/app.js"></script>
    </body>
    </html>
  `)
})

export default app
