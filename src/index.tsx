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
        <title>レシピ動画 & 材料発注サイト</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    </head>
    <body class="bg-gray-50">
        <!-- ヘッダー -->
        <header class="bg-white shadow-sm">
            <div class="max-w-7xl mx-auto px-4 py-4">
                <div class="flex items-center justify-between">
                    <h1 class="text-2xl font-bold text-gray-800">
                        <i class="fas fa-cookie-bite text-orange-500 mr-2"></i>
                        パン・洋菓子レシピ
                    </h1>
                    <button id="cartBtn" class="relative bg-orange-500 text-white px-4 py-2 rounded-lg hover:bg-orange-600 transition">
                        <i class="fas fa-shopping-cart mr-2"></i>
                        カート
                        <span id="cartCount" class="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full w-6 h-6 flex items-center justify-center">0</span>
                    </button>
                </div>
            </div>
        </header>

        <!-- メインコンテンツ -->
        <main class="max-w-7xl mx-auto px-4 py-8">
            <!-- カテゴリフィルター -->
            <div class="mb-6">
                <div class="flex gap-4">
                    <button class="category-btn px-6 py-2 rounded-lg bg-orange-500 text-white font-medium" data-category="">
                        すべて
                    </button>
                    <button class="category-btn px-6 py-2 rounded-lg bg-gray-200 text-gray-700 font-medium" data-category="パン">
                        パン
                    </button>
                    <button class="category-btn px-6 py-2 rounded-lg bg-gray-200 text-gray-700 font-medium" data-category="洋菓子">
                        洋菓子
                    </button>
                </div>
            </div>

            <!-- レシピ一覧 -->
            <div id="recipeList" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <!-- ここにレシピカードが動的に追加されます -->
            </div>
        </main>

        <!-- カートモーダル -->
        <div id="cartModal" class="hidden fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div class="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-2xl font-bold">カート</h2>
                    <button id="closeCartBtn" class="text-gray-500 hover:text-gray-700">
                        <i class="fas fa-times text-2xl"></i>
                    </button>
                </div>
                <div id="cartItems" class="mb-6">
                    <!-- カートアイテムが表示されます -->
                </div>
                <div class="border-t pt-4">
                    <div class="flex justify-between items-center mb-4">
                        <span class="text-xl font-bold">合計金額:</span>
                        <span id="totalAmount" class="text-2xl font-bold text-orange-500">¥0</span>
                    </div>
                    <button id="checkoutBtn" class="w-full bg-orange-500 text-white py-3 rounded-lg font-bold hover:bg-orange-600 transition">
                        注文する
                    </button>
                </div>
            </div>
        </div>

        <!-- 注文フォームモーダル -->
        <div id="orderModal" class="hidden fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div class="bg-white rounded-lg p-6 max-w-md w-full mx-4">
                <h2 class="text-2xl font-bold mb-4">注文情報入力</h2>
                <form id="orderForm">
                    <div class="mb-4">
                        <label class="block text-gray-700 mb-2">お名前 *</label>
                        <input type="text" id="customerName" required class="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500">
                    </div>
                    <div class="mb-4">
                        <label class="block text-gray-700 mb-2">メールアドレス *</label>
                        <input type="email" id="customerEmail" required class="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500">
                    </div>
                    <div class="mb-4">
                        <label class="block text-gray-700 mb-2">電話番号</label>
                        <input type="tel" id="customerPhone" class="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500">
                    </div>
                    <div class="mb-6">
                        <label class="block text-gray-700 mb-2">備考</label>
                        <textarea id="orderNotes" rows="3" class="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"></textarea>
                    </div>
                    <div class="flex gap-4">
                        <button type="button" id="cancelOrderBtn" class="flex-1 bg-gray-300 text-gray-700 py-2 rounded-lg font-bold hover:bg-gray-400 transition">
                            キャンセル
                        </button>
                        <button type="submit" class="flex-1 bg-orange-500 text-white py-2 rounded-lg font-bold hover:bg-orange-600 transition">
                            確定
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
