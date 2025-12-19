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
        b.classList.remove('text-white', 'shadow-md');
        b.classList.add('bg-white', 'text-[#8B6F47]', 'border-2', 'border-[#E8DCC4]');
        b.style.background = '';
      });
      e.target.classList.remove('bg-white', 'text-[#8B6F47]', 'border-2', 'border-[#E8DCC4]');
      e.target.classList.add('text-white', 'shadow-md');
      e.target.style.background = 'linear-gradient(135deg, #B88A5A, #8B6F47)';
      
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
    recipeList.innerHTML = `
      <div class="col-span-full text-center py-16">
        <i class="fas fa-search text-6xl text-gray-300 mb-4"></i>
        <p class="text-gray-500 text-lg">レシピが見つかりませんでした</p>
      </div>
    `;
    return;
  }

  recipes.forEach((recipe, index) => {
    const card = document.createElement('div');
    card.className = 'card-natural cursor-pointer animate-fade-in-up hover-grow';
    card.style.animationDelay = `${index * 0.1}s`;
    card.onclick = () => showRecipeDetail(recipe.id);
    
    card.innerHTML = `
      <div class="relative pb-56 overflow-hidden">
        ${recipe.video_url ? 
          `<iframe 
            class="absolute inset-0 w-full h-full"
            src="${recipe.video_url}" 
            frameborder="0" 
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
            allowfullscreen
          ></iframe>` :
          `<div class="absolute inset-0 bg-gradient-to-br from-[#D4A574] via-[#B88A5A] to-[#8B6F47] flex items-center justify-center">
            <i class="fas fa-video text-white text-6xl opacity-50"></i>
          </div>`
        }
        <div class="absolute top-3 right-3 flex gap-2">
          ${recipe.category === 'パン' ? 
            '<span class="badge-natural badge-bread"><i class="fas fa-bread-slice mr-1"></i>パン</span>' : 
            '<span class="badge-natural badge-pastry"><i class="fas fa-cake-candles mr-1"></i>洋菓子</span>'
          }
        </div>
      </div>
      <div class="p-5">
        <div class="flex items-center gap-2 mb-3">
          ${recipe.difficulty ? 
            `<span class="badge-natural badge-difficulty">
              <i class="fas fa-signal mr-1"></i>${recipe.difficulty}
            </span>` : ''
          }
          <span class="text-xs text-gray-500">
            <i class="fas fa-shopping-basket mr-1"></i>${recipe.ingredient_count}種類の材料
          </span>
        </div>
        <h3 class="text-xl font-bold heading-elegant text-[#4A4A48] mb-2 line-clamp-1">
          ${recipe.title}
        </h3>
        <p class="text-[#8B6F47] text-sm leading-relaxed mb-4 line-clamp-2">
          ${recipe.description || 'おいしいレシピをお楽しみください'}
        </p>
        <div class="flex items-center gap-4 text-sm text-[#B88A5A] pt-3 border-t border-[#E8DCC4]">
          ${recipe.prep_time ? `
            <div class="flex items-center gap-1">
              <i class="fas fa-clock"></i>
              <span>${recipe.prep_time}分</span>
            </div>
          ` : ''}
          ${recipe.cook_time ? `
            <div class="flex items-center gap-1">
              <i class="fas fa-fire"></i>
              <span>${recipe.cook_time}分</span>
            </div>
          ` : ''}
          ${recipe.servings ? `
            <div class="flex items-center gap-1">
              <i class="fas fa-users"></i>
              <span>${recipe.servings}人分</span>
            </div>
          ` : ''}
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
    modal.className = 'modal-overlay fixed inset-0 flex items-center justify-center z-50 p-4';
    modal.onclick = (e) => {
      if (e.target === modal) modal.remove();
    };
    
    modal.innerHTML = `
      <div class="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden animate-scale-in">
        <div class="sticky top-0 bg-gradient-to-r from-[#FAF8F3] to-[#FFFEF9] border-b border-[#E8DCC4] px-6 py-5 flex justify-between items-center z-10">
          <div>
            <h2 class="text-2xl font-bold heading-elegant text-[#4A4A48]">${recipe.title}</h2>
            <div class="flex gap-2 mt-2">
              ${recipe.category === 'パン' ? 
                '<span class="badge-natural badge-bread"><i class="fas fa-bread-slice mr-1"></i>パン</span>' : 
                '<span class="badge-natural badge-pastry"><i class="fas fa-cake-candles mr-1"></i>洋菓子</span>'
              }
              ${recipe.difficulty ? 
                `<span class="badge-natural badge-difficulty"><i class="fas fa-signal mr-1"></i>${recipe.difficulty}</span>` : ''
              }
            </div>
          </div>
          <button onclick="this.closest('.fixed').remove()" 
                  class="w-10 h-10 rounded-full bg-white hover:bg-[#F5F3EE] transition-smooth flex items-center justify-center text-[#8B6F47]">
            <i class="fas fa-times text-lg"></i>
          </button>
        </div>
        
        <div class="p-6 overflow-y-auto" style="max-height: calc(90vh - 110px);">
          <!-- 動画 -->
          ${recipe.video_url ? `
            <div class="mb-6 relative pb-56 rounded-2xl overflow-hidden shadow-lg">
              <iframe 
                class="absolute inset-0 w-full h-full"
                src="${recipe.video_url}" 
                frameborder="0" 
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                allowfullscreen
              ></iframe>
            </div>
          ` : ''}
          
          <!-- レシピ情報 -->
          <div class="section-natural mb-6">
            <p class="text-[#4A4A48] leading-relaxed mb-4">${recipe.description || ''}</p>
            <div class="flex flex-wrap gap-3">
              ${recipe.prep_time ? `
                <div class="flex items-center gap-2 px-4 py-2 rounded-full bg-[#F5F3EE]">
                  <i class="fas fa-clock text-[#B88A5A]"></i>
                  <span class="text-[#4A4A48] text-sm">準備 ${recipe.prep_time}分</span>
                </div>
              ` : ''}
              ${recipe.cook_time ? `
                <div class="flex items-center gap-2 px-4 py-2 rounded-full bg-[#F5F3EE]">
                  <i class="fas fa-fire text-[#B88A5A]"></i>
                  <span class="text-[#4A4A48] text-sm">調理 ${recipe.cook_time}分</span>
                </div>
              ` : ''}
              ${recipe.servings ? `
                <div class="flex items-center gap-2 px-4 py-2 rounded-full bg-[#F5F3EE]">
                  <i class="fas fa-users text-[#B88A5A]"></i>
                  <span class="text-[#4A4A48] text-sm">${recipe.servings}人分</span>
                </div>
              ` : ''}
            </div>
          </div>
          
          <!-- 材料リスト -->
          <div class="mb-6">
            <h3 class="text-xl font-bold heading-elegant text-[#4A4A48] mb-4 flex items-center gap-2">
              <i class="fas fa-shopping-basket text-[#B88A5A]"></i>
              必要な材料
            </h3>
            <div class="space-y-3">
              ${ingredients.map(ing => `
                <div class="card-natural p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 hover-grow">
                  <div class="flex-1">
                    <div class="font-semibold text-[#4A4A48] mb-1">${ing.name}</div>
                    <div class="text-sm text-[#8B6F47]">
                      ${ing.quantity} ${ing.unit}
                      <span class="mx-2 text-[#D4A574]">•</span>
                      <span class="font-semibold text-[#B88A5A]">¥${Math.round(ing.price_per_unit * ing.quantity).toLocaleString()}</span>
                    </div>
                  </div>
                  <button 
                    onclick="event.stopPropagation(); addToCart(${ing.id}, '${ing.name}', ${ing.price_per_unit}, '${ing.ingredient_unit}', ${ing.quantity})"
                    class="btn-natural px-5 py-2 rounded-full text-white font-medium flex items-center gap-2 whitespace-nowrap"
                    style="background: linear-gradient(135deg, #B88A5A, #8B6F47);"
                  >
                    <i class="fas fa-cart-plus"></i>
                    <span>カートに追加</span>
                  </button>
                </div>
              `).join('')}
            </div>
            
            <!-- まとめて追加ボタン -->
            <button 
              onclick="addAllIngredientsToCart(${JSON.stringify(ingredients).replace(/"/g, '&quot;')})"
              class="btn-natural w-full mt-4 py-4 rounded-full text-white font-bold text-lg"
              style="background: linear-gradient(135deg, #9CAF88, #6B7F5C);"
            >
              <i class="fas fa-shopping-basket mr-2"></i>
              すべての材料をまとめてカートに追加
            </button>
          </div>
          
          <!-- 作り方 -->
          ${recipe.instructions ? `
            <div class="section-natural">
              <h3 class="text-xl font-bold heading-elegant text-[#4A4A48] mb-4 flex items-center gap-2">
                <i class="fas fa-list-ol text-[#B88A5A]"></i>
                作り方
              </h3>
              <div class="text-[#4A4A48] leading-relaxed whitespace-pre-line">
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
  toast.className = 'toast-natural fixed bottom-6 right-6 z-50 animate-slide-in-right';
  toast.innerHTML = '<i class="fas fa-check-circle"></i><span>カートに追加しました</span>';
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100px)';
    setTimeout(() => toast.remove(), 300);
  }, 2000);
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
    cartItems.innerHTML = `
      <div class="text-center py-12">
        <i class="fas fa-shopping-basket text-6xl text-gray-300 mb-4"></i>
        <p class="text-gray-500 text-lg">カートは空です</p>
        <p class="text-gray-400 text-sm mt-2">お気に入りのレシピから材料を追加しましょう</p>
      </div>
    `;
    totalAmount.textContent = '¥0';
  } else {
    let total = 0;
    cartItems.innerHTML = cart.map((item, index) => {
      const subtotal = item.price_per_unit * item.quantity;
      total += subtotal;
      
      return `
        <div class="card-natural p-4 mb-3">
          <div class="flex items-center justify-between gap-4">
            <div class="flex-1">
              <div class="font-semibold text-[#4A4A48] mb-1">${item.name}</div>
              <div class="text-sm text-[#8B6F47]">¥${item.price_per_unit.toLocaleString()} / ${item.unit}</div>
            </div>
            <div class="flex items-center gap-3">
              <div class="flex items-center gap-2 bg-[#F5F3EE] rounded-full px-2 py-1">
                <button onclick="updateCartQuantity(${index}, -1)" 
                        class="w-7 h-7 rounded-full bg-white hover:bg-[#E8DCC4] transition-smooth flex items-center justify-center text-[#8B6F47]">
                  <i class="fas fa-minus text-xs"></i>
                </button>
                <span class="w-10 text-center font-semibold text-[#4A4A48]">${item.quantity}</span>
                <button onclick="updateCartQuantity(${index}, 1)" 
                        class="w-7 h-7 rounded-full bg-white hover:bg-[#E8DCC4] transition-smooth flex items-center justify-center text-[#8B6F47]">
                  <i class="fas fa-plus text-xs"></i>
                </button>
              </div>
              <div class="w-24 text-right font-bold text-[#B88A5A]">¥${subtotal.toLocaleString()}</div>
              <button onclick="removeFromCart(${index})" 
                      class="w-9 h-9 rounded-full bg-red-50 hover:bg-red-100 text-red-500 transition-smooth flex items-center justify-center">
                <i class="fas fa-trash text-sm"></i>
              </button>
            </div>
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
