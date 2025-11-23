// グローバル変数
let recipes = [];
let cart = [];
let currentCategory = '';

// ページロード時の初期化
document.addEventListener('DOMContentLoaded', async () => {
  await loadRecipes();
  setupEventListeners();
  updateCartCount();
  loadCartFromStorage();
});

// イベントリスナー設定
function setupEventListeners() {
  // カテゴリボタン
  document.querySelectorAll('.category-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const category = e.target.dataset.category;
      currentCategory = category;
      
      // ボタンのスタイル更新
      document.querySelectorAll('.category-btn').forEach(b => {
        b.classList.remove('bg-orange-500', 'text-white');
        b.classList.add('bg-gray-200', 'text-gray-700');
      });
      e.target.classList.remove('bg-gray-200', 'text-gray-700');
      e.target.classList.add('bg-orange-500', 'text-white');
      
      await loadRecipes(category);
    });
  });

  // カートボタン
  document.getElementById('cartBtn').addEventListener('click', () => {
    showCart();
  });

  // カートを閉じる
  document.getElementById('closeCartBtn').addEventListener('click', () => {
    document.getElementById('cartModal').classList.add('hidden');
  });

  // 注文ボタン
  document.getElementById('checkoutBtn').addEventListener('click', () => {
    if (cart.length === 0) {
      alert('カートに商品がありません');
      return;
    }
    document.getElementById('cartModal').classList.add('hidden');
    document.getElementById('orderModal').classList.remove('hidden');
  });

  // 注文キャンセル
  document.getElementById('cancelOrderBtn').addEventListener('click', () => {
    document.getElementById('orderModal').classList.add('hidden');
  });

  // 注文フォーム送信
  document.getElementById('orderForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    await submitOrder();
  });
}

// レシピ一覧の読み込み
async function loadRecipes(category = '') {
  try {
    const url = category ? `/api/recipes?category=${encodeURIComponent(category)}` : '/api/recipes';
    const response = await axios.get(url);
    recipes = response.data.recipes;
    renderRecipes();
  } catch (error) {
    console.error('Failed to load recipes:', error);
    alert('レシピの読み込みに失敗しました');
  }
}

// レシピカードのレンダリング
function renderRecipes() {
  const recipeList = document.getElementById('recipeList');
  recipeList.innerHTML = '';

  if (recipes.length === 0) {
    recipeList.innerHTML = '<p class="col-span-full text-center text-gray-500 py-12">レシピが見つかりませんでした</p>';
    return;
  }

  recipes.forEach(recipe => {
    const card = document.createElement('div');
    card.className = 'bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition cursor-pointer';
    card.onclick = () => showRecipeDetail(recipe.id);
    
    card.innerHTML = `
      <div class="relative pb-56">
        ${recipe.video_url ? 
          `<iframe 
            class="absolute inset-0 w-full h-full"
            src="${recipe.video_url}" 
            frameborder="0" 
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
            allowfullscreen
          ></iframe>` :
          `<div class="absolute inset-0 bg-gradient-to-br from-orange-400 to-pink-500 flex items-center justify-center">
            <i class="fas fa-video text-white text-6xl"></i>
          </div>`
        }
      </div>
      <div class="p-4">
        <div class="flex items-center gap-2 mb-2">
          <span class="px-2 py-1 text-xs font-semibold rounded ${
            recipe.category === 'パン' ? 'bg-yellow-100 text-yellow-800' : 'bg-pink-100 text-pink-800'
          }">
            ${recipe.category}
          </span>
          ${recipe.difficulty ? `
            <span class="px-2 py-1 text-xs font-semibold rounded bg-gray-100 text-gray-800">
              ${recipe.difficulty}
            </span>
          ` : ''}
        </div>
        <h3 class="text-lg font-bold mb-2">${recipe.title}</h3>
        <p class="text-gray-600 text-sm mb-3 line-clamp-2">${recipe.description || ''}</p>
        <div class="flex items-center justify-between text-sm text-gray-500">
          <div>
            <i class="fas fa-clock mr-1"></i>
            ${recipe.prep_time ? `準備 ${recipe.prep_time}分` : ''}
            ${recipe.cook_time ? ` / 調理 ${recipe.cook_time}分` : ''}
          </div>
          <div>
            <i class="fas fa-shopping-basket mr-1"></i>
            ${recipe.ingredient_count}種類
          </div>
        </div>
      </div>
    `;
    
    recipeList.appendChild(card);
  });
}

// レシピ詳細表示
async function showRecipeDetail(recipeId) {
  try {
    const response = await axios.get(`/api/recipes/${recipeId}`);
    const { recipe, ingredients } = response.data;
    
    // モーダル作成
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4';
    modal.onclick = (e) => {
      if (e.target === modal) modal.remove();
    };
    
    modal.innerHTML = `
      <div class="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div class="sticky top-0 bg-white border-b px-6 py-4 flex justify-between items-center">
          <h2 class="text-2xl font-bold">${recipe.title}</h2>
          <button onclick="this.closest('.fixed').remove()" class="text-gray-500 hover:text-gray-700">
            <i class="fas fa-times text-2xl"></i>
          </button>
        </div>
        
        <div class="p-6">
          <!-- 動画 -->
          ${recipe.video_url ? `
            <div class="mb-6 relative pb-56">
              <iframe 
                class="absolute inset-0 w-full h-full rounded-lg"
                src="${recipe.video_url}" 
                frameborder="0" 
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                allowfullscreen
              ></iframe>
            </div>
          ` : ''}
          
          <!-- レシピ情報 -->
          <div class="mb-6">
            <div class="flex gap-2 mb-4">
              <span class="px-3 py-1 text-sm font-semibold rounded ${
                recipe.category === 'パン' ? 'bg-yellow-100 text-yellow-800' : 'bg-pink-100 text-pink-800'
              }">
                ${recipe.category}
              </span>
              ${recipe.difficulty ? `
                <span class="px-3 py-1 text-sm font-semibold rounded bg-gray-100 text-gray-800">
                  ${recipe.difficulty}
                </span>
              ` : ''}
            </div>
            <p class="text-gray-700 mb-4">${recipe.description || ''}</p>
            <div class="flex gap-6 text-sm text-gray-600">
              ${recipe.prep_time ? `<div><i class="fas fa-clock mr-2"></i>準備時間: ${recipe.prep_time}分</div>` : ''}
              ${recipe.cook_time ? `<div><i class="fas fa-fire mr-2"></i>調理時間: ${recipe.cook_time}分</div>` : ''}
              ${recipe.servings ? `<div><i class="fas fa-users mr-2"></i>分量: ${recipe.servings}人分</div>` : ''}
            </div>
          </div>
          
          <!-- 材料リスト -->
          <div class="mb-6">
            <h3 class="text-xl font-bold mb-4">
              <i class="fas fa-shopping-basket text-orange-500 mr-2"></i>
              必要な材料
            </h3>
            <div class="space-y-3">
              ${ingredients.map(ing => `
                <div class="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition">
                  <div class="flex-1">
                    <div class="font-semibold">${ing.name}</div>
                    <div class="text-sm text-gray-600">
                      ${ing.quantity} ${ing.unit}
                      <span class="mx-2">•</span>
                      ¥${Math.round(ing.price_per_unit * ing.quantity).toLocaleString()}
                    </div>
                  </div>
                  <button 
                    onclick="event.stopPropagation(); addToCart(${ing.id}, '${ing.name}', ${ing.price_per_unit}, '${ing.ingredient_unit}', ${ing.quantity})"
                    class="bg-orange-500 text-white px-4 py-2 rounded-lg hover:bg-orange-600 transition flex items-center gap-2"
                  >
                    <i class="fas fa-cart-plus"></i>
                    カートに追加
                  </button>
                </div>
              `).join('')}
            </div>
            
            <!-- まとめて追加ボタン -->
            <button 
              onclick="addAllIngredientsToCart(${JSON.stringify(ingredients).replace(/"/g, '&quot;')})"
              class="w-full mt-4 bg-orange-600 text-white py-3 rounded-lg font-bold hover:bg-orange-700 transition"
            >
              <i class="fas fa-cart-plus mr-2"></i>
              すべての材料をカートに追加
            </button>
          </div>
          
          <!-- 作り方 -->
          ${recipe.instructions ? `
            <div>
              <h3 class="text-xl font-bold mb-4">
                <i class="fas fa-list-ol text-orange-500 mr-2"></i>
                作り方
              </h3>
              <div class="bg-gray-50 p-4 rounded-lg whitespace-pre-line">
                ${recipe.instructions}
              </div>
            </div>
          ` : ''}
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
  } catch (error) {
    console.error('Failed to load recipe details:', error);
    alert('レシピの詳細を読み込めませんでした');
  }
}

// カートに追加
function addToCart(ingredientId, name, pricePerUnit, unit, quantity = 1) {
  const existingItem = cart.find(item => item.ingredient_id === ingredientId);
  
  if (existingItem) {
    existingItem.quantity += quantity;
  } else {
    cart.push({
      ingredient_id: ingredientId,
      name,
      price_per_unit: pricePerUnit,
      unit,
      quantity
    });
  }
  
  updateCartCount();
  saveCartToStorage();
  
  // フィードバック
  const toast = document.createElement('div');
  toast.className = 'fixed bottom-4 right-4 bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg z-50 animate-bounce';
  toast.innerHTML = '<i class="fas fa-check-circle mr-2"></i>カートに追加しました';
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2000);
}

// すべての材料をカートに追加
function addAllIngredientsToCart(ingredients) {
  ingredients.forEach(ing => {
    addToCart(ing.id, ing.name, ing.price_per_unit, ing.ingredient_unit, ing.quantity);
  });
}

// カート表示
function showCart() {
  const cartItems = document.getElementById('cartItems');
  const totalAmount = document.getElementById('totalAmount');
  
  if (cart.length === 0) {
    cartItems.innerHTML = '<p class="text-center text-gray-500 py-8">カートは空です</p>';
    totalAmount.textContent = '¥0';
  } else {
    let total = 0;
    cartItems.innerHTML = cart.map((item, index) => {
      const subtotal = item.price_per_unit * item.quantity;
      total += subtotal;
      
      return `
        <div class="flex items-center justify-between p-4 border-b">
          <div class="flex-1">
            <div class="font-semibold">${item.name}</div>
            <div class="text-sm text-gray-600">¥${item.price_per_unit.toLocaleString()} / ${item.unit}</div>
          </div>
          <div class="flex items-center gap-4">
            <div class="flex items-center gap-2">
              <button onclick="updateCartQuantity(${index}, -1)" class="w-8 h-8 bg-gray-200 rounded-full hover:bg-gray-300">
                <i class="fas fa-minus text-xs"></i>
              </button>
              <span class="w-12 text-center font-semibold">${item.quantity}</span>
              <button onclick="updateCartQuantity(${index}, 1)" class="w-8 h-8 bg-gray-200 rounded-full hover:bg-gray-300">
                <i class="fas fa-plus text-xs"></i>
              </button>
            </div>
            <div class="w-24 text-right font-semibold">¥${subtotal.toLocaleString()}</div>
            <button onclick="removeFromCart(${index})" class="text-red-500 hover:text-red-700">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');
    
    totalAmount.textContent = `¥${total.toLocaleString()}`;
  }
  
  document.getElementById('cartModal').classList.remove('hidden');
}

// カート数量更新
function updateCartQuantity(index, delta) {
  cart[index].quantity += delta;
  
  if (cart[index].quantity <= 0) {
    cart.splice(index, 1);
  }
  
  updateCartCount();
  saveCartToStorage();
  showCart();
}

// カートから削除
function removeFromCart(index) {
  cart.splice(index, 1);
  updateCartCount();
  saveCartToStorage();
  showCart();
}

// カート数更新
function updateCartCount() {
  const count = cart.reduce((sum, item) => sum + item.quantity, 0);
  document.getElementById('cartCount').textContent = count;
}

// カートをローカルストレージに保存
function saveCartToStorage() {
  localStorage.setItem('cart', JSON.stringify(cart));
}

// カートをローカルストレージから読み込み
function loadCartFromStorage() {
  const saved = localStorage.getItem('cart');
  if (saved) {
    cart = JSON.parse(saved);
    updateCartCount();
  }
}

// 注文送信
async function submitOrder() {
  const customerName = document.getElementById('customerName').value;
  const customerEmail = document.getElementById('customerEmail').value;
  const customerPhone = document.getElementById('customerPhone').value;
  const notes = document.getElementById('orderNotes').value;
  
  try {
    const response = await axios.post('/api/orders', {
      customer_name: customerName,
      customer_email: customerEmail,
      customer_phone: customerPhone,
      items: cart,
      notes: notes
    });
    
    alert(`注文が完了しました！\n注文番号: ${response.data.order_id}\n合計金額: ¥${response.data.total_amount.toLocaleString()}`);
    
    // カートをクリア
    cart = [];
    updateCartCount();
    saveCartToStorage();
    
    // モーダルを閉じる
    document.getElementById('orderModal').classList.add('hidden');
    
    // フォームをリセット
    document.getElementById('orderForm').reset();
  } catch (error) {
    console.error('Failed to submit order:', error);
    alert('注文の送信に失敗しました。もう一度お試しください。');
  }
}
