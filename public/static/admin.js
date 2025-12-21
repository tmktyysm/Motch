// 管理画面のJavaScript

let allRecipes = [];
let allIngredients = [];
let editingRecipeId = null;

// ページロード時の初期化
document.addEventListener('DOMContentLoaded', async () => {
  await loadIngredients();
  await loadAdminRecipes();
  setupEventListeners();
});

// イベントリスナー設定
function setupEventListeners() {
  // タブ切り替え
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tab = e.target.closest('.tab-btn').dataset.tab;
      switchTab(tab);
    });
  });

  // レシピフォーム送信
  document.getElementById('recipeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveRecipe();
  });

  // キャンセルボタン
  document.getElementById('cancelBtn').addEventListener('click', () => {
    resetForm();
    switchTab('recipes');
  });

  // 材料追加ボタン
  document.getElementById('addIngredientBtn').addEventListener('click', () => {
    addIngredientRow();
  });
}

// タブ切り替え
function switchTab(tabName) {
  // タブボタンのスタイル更新
  document.querySelectorAll('.tab-btn').forEach(btn => {
    if (btn.dataset.tab === tabName) {
      btn.classList.add('text-[#B88A5A]', 'border-b-2', 'border-[#B88A5A]');
      btn.classList.remove('text-[#8B6F47]');
    } else {
      btn.classList.remove('text-[#B88A5A]', 'border-b-2', 'border-[#B88A5A]');
      btn.classList.add('text-[#8B6F47]');
    }
  });

  // タブコンテンツの表示切り替え
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.add('hidden');
  });
  document.getElementById(`${tabName}-tab`).classList.remove('hidden');
  
  // タブ切り替え時にデータを読み込む
  if (tabName === 'customers') {
    loadCustomers();
  } else if (tabName === 'orders') {
    loadOrders();
  }
}

// 材料一覧の読み込み
async function loadIngredients() {
  try {
    const response = await axios.get('/api/ingredients');
    allIngredients = response.data.ingredients;
  } catch (error) {
    console.error('Failed to load ingredients:', error);
    showToast('材料の読み込みに失敗しました', 'error');
  }
}

// レシピ一覧の読み込み（管理画面用）
async function loadAdminRecipes() {
  try {
    const response = await axios.get('/api/recipes');
    allRecipes = response.data.recipes;
    renderAdminRecipes();
  } catch (error) {
    console.error('Failed to load recipes:', error);
    showToast('レシピの読み込みに失敗しました', 'error');
  }
}

// レシピ一覧のレンダリング（管理画面用）
function renderAdminRecipes() {
  const list = document.getElementById('adminRecipeList');
  
  if (allRecipes.length === 0) {
    list.innerHTML = `
      <div class="text-center py-12">
        <i class="fas fa-book text-6xl text-gray-300 mb-4"></i>
        <p class="text-gray-500 text-lg">レシピがまだありません</p>
        <p class="text-gray-400 text-sm mt-2">「新規作成」タブから新しいレシピを追加しましょう</p>
      </div>
    `;
    return;
  }

  list.innerHTML = allRecipes.map(recipe => `
    <div class="card-natural p-4 flex items-center justify-between">
      <div class="flex-1">
        <div class="flex items-center gap-3 mb-2">
          <h3 class="font-bold text-[#4A4A48] text-lg">${recipe.title}</h3>
          ${recipe.category === 'パン' ? 
            '<span class="badge-natural badge-bread"><i class="fas fa-bread-slice mr-1"></i>パン</span>' : 
            '<span class="badge-natural badge-pastry"><i class="fas fa-cake-candles mr-1"></i>洋菓子</span>'
          }
          ${recipe.difficulty ? 
            `<span class="badge-natural badge-difficulty">${recipe.difficulty}</span>` : ''
          }
        </div>
        <p class="text-sm text-[#8B6F47] line-clamp-2">${recipe.description || 'No description'}</p>
        <div class="flex gap-4 mt-2 text-xs text-[#B88A5A]">
          ${recipe.prep_time ? `<span><i class="fas fa-clock mr-1"></i>${recipe.prep_time}分</span>` : ''}
          ${recipe.cook_time ? `<span><i class="fas fa-fire mr-1"></i>${recipe.cook_time}分</span>` : ''}
          ${recipe.ingredient_count ? `<span><i class="fas fa-shopping-basket mr-1"></i>${recipe.ingredient_count}種類</span>` : ''}
        </div>
      </div>
      <div class="flex gap-2 ml-4">
        <button onclick="editRecipe(${recipe.id})" 
                class="btn-natural px-4 py-2 rounded-lg text-white font-medium"
                style="background: linear-gradient(135deg, #B88A5A, #8B6F47);">
          <i class="fas fa-edit mr-1"></i>編集
        </button>
        <button onclick="deleteRecipe(${recipe.id}, '${recipe.title.replace(/'/g, "\\'")}')" 
                class="btn-natural px-4 py-2 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 font-medium">
          <i class="fas fa-trash mr-1"></i>削除
        </button>
      </div>
    </div>
  `).join('');
}

// レシピ編集
async function editRecipe(recipeId) {
  try {
    const response = await axios.get(`/api/recipes/${recipeId}`);
    const { recipe, ingredients } = response.data;
    
    // フォームに値を設定
    editingRecipeId = recipeId;
    document.getElementById('recipeId').value = recipeId;
    document.getElementById('title').value = recipe.title || '';
    document.getElementById('category').value = recipe.category || '';
    document.getElementById('difficulty').value = recipe.difficulty || '';
    document.getElementById('prep_time').value = recipe.prep_time || '';
    document.getElementById('cook_time').value = recipe.cook_time || '';
    document.getElementById('servings').value = recipe.servings || '';
    document.getElementById('video_url').value = recipe.video_url || '';
    document.getElementById('image_url').value = recipe.image_url || '';
    document.getElementById('description').value = recipe.description || '';
    document.getElementById('instructions').value = recipe.instructions || '';
    
    // 材料リストをクリアして再設定
    document.getElementById('ingredientsList').innerHTML = '';
    ingredients.forEach(ing => {
      addIngredientRow(ing.id, ing.quantity, ing.unit);
    });
    
    // 送信ボタンのテキストを変更
    document.getElementById('submitBtnText').textContent = 'レシピを更新';
    
    // 新規作成タブに切り替え
    switchTab('create');
    
    // スクロールをトップに
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (error) {
    console.error('Failed to load recipe:', error);
    showToast('レシピの読み込みに失敗しました', 'error');
  }
}

// レシピ削除
async function deleteRecipe(recipeId, recipeTitle) {
  if (!confirm(`「${recipeTitle}」を削除してもよろしいですか？\nこの操作は取り消せません。`)) {
    return;
  }
  
  try {
    await axios.delete(`/api/recipes/${recipeId}`);
    showToast('レシピを削除しました', 'success');
    await loadAdminRecipes();
  } catch (error) {
    console.error('Failed to delete recipe:', error);
    showToast('レシピの削除に失敗しました', 'error');
  }
}

// 材料行を追加
function addIngredientRow(ingredientId = '', quantity = '', unit = '') {
  const container = document.getElementById('ingredientsList');
  const index = container.children.length;
  
  const row = document.createElement('div');
  row.className = 'flex gap-2 items-center p-3 bg-[#F5F3EE] rounded-lg';
  row.innerHTML = `
    <select class="ingredient-select input-natural flex-1" data-index="${index}" required>
      <option value="">材料を選択</option>
      ${allIngredients.map(ing => 
        `<option value="${ing.id}" ${ing.id == ingredientId ? 'selected' : ''}>${ing.name}</option>`
      ).join('')}
    </select>
    <input type="number" class="ingredient-quantity input-natural w-24" 
           placeholder="数量" step="0.1" value="${quantity}" required>
    <input type="text" class="ingredient-unit input-natural w-20" 
           placeholder="単位" value="${unit}" required>
    <button type="button" onclick="this.closest('.flex').remove()" 
            class="w-9 h-9 rounded-full bg-red-50 hover:bg-red-100 text-red-500 transition-smooth flex items-center justify-center">
      <i class="fas fa-times"></i>
    </button>
  `;
  
  container.appendChild(row);
}

// レシピ保存
async function saveRecipe() {
  try {
    // フォームデータを収集
    const recipeData = {
      title: document.getElementById('title').value,
      category: document.getElementById('category').value,
      difficulty: document.getElementById('difficulty').value || null,
      prep_time: parseInt(document.getElementById('prep_time').value) || null,
      cook_time: parseInt(document.getElementById('cook_time').value) || null,
      servings: parseInt(document.getElementById('servings').value) || null,
      video_url: document.getElementById('video_url').value || null,
      image_url: document.getElementById('image_url').value || null,
      description: document.getElementById('description').value || null,
      instructions: document.getElementById('instructions').value || null,
      ingredients: []
    };
    
    // 材料データを収集
    const ingredientRows = document.querySelectorAll('#ingredientsList > div');
    ingredientRows.forEach(row => {
      const ingredientId = row.querySelector('.ingredient-select').value;
      const quantity = parseFloat(row.querySelector('.ingredient-quantity').value);
      const unit = row.querySelector('.ingredient-unit').value;
      
      if (ingredientId && quantity && unit) {
        recipeData.ingredients.push({
          ingredient_id: parseInt(ingredientId),
          quantity: quantity,
          unit: unit
        });
      }
    });
    
    // APIリクエスト
    if (editingRecipeId) {
      // 更新
      await axios.put(`/api/recipes/${editingRecipeId}`, recipeData);
      showToast('レシピを更新しました', 'success');
    } else {
      // 新規作成
      await axios.post('/api/recipes', recipeData);
      showToast('レシピを作成しました', 'success');
    }
    
    // フォームをリセットしてレシピ一覧に戻る
    resetForm();
    await loadAdminRecipes();
    switchTab('recipes');
    
  } catch (error) {
    console.error('Failed to save recipe:', error);
    const message = error.response?.data?.error || 'レシピの保存に失敗しました';
    showToast(message, 'error');
  }
}

// フォームをリセット
function resetForm() {
  editingRecipeId = null;
  document.getElementById('recipeId').value = '';
  document.getElementById('recipeForm').reset();
  document.getElementById('ingredientsList').innerHTML = '';
  document.getElementById('submitBtnText').textContent = 'レシピを保存';
}

// トースト通知を表示
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `fixed bottom-6 right-6 z-50 animate-slide-in-right px-6 py-4 rounded-xl shadow-2xl flex items-center gap-3`;
  
  if (type === 'success') {
    toast.style.background = 'linear-gradient(135deg, #9CAF88, #6B7F5C)';
    toast.innerHTML = `<i class="fas fa-check-circle text-white text-xl"></i><span class="text-white font-medium">${message}</span>`;
  } else {
    toast.style.background = 'linear-gradient(135deg, #E57373, #D32F2F)';
    toast.innerHTML = `<i class="fas fa-exclamation-circle text-white text-xl"></i><span class="text-white font-medium">${message}</span>`;
  }
  
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100px)';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// 顧客情報一覧を読み込む
async function loadCustomers() {
  const container = document.getElementById('customersList');
  container.innerHTML = '<p class="text-center text-[#8B6F47] py-8"><i class="fas fa-spinner fa-spin mr-2"></i>読み込み中...</p>';
  
  try {
    const response = await axios.get('/api/admin/customers');
    const customers = response.data.customers;
    
    if (customers.length === 0) {
      container.innerHTML = '<p class="text-center text-[#8B6F47] py-8">顧客情報がありません</p>';
      return;
    }
    
    container.innerHTML = `
      <table class="w-full">
        <thead class="bg-[#F5F3EE]">
          <tr>
            <th class="px-4 py-3 text-left text-sm font-semibold text-[#4A4A48]">ID</th>
            <th class="px-4 py-3 text-left text-sm font-semibold text-[#4A4A48]">ユーザー名</th>
            <th class="px-4 py-3 text-left text-sm font-semibold text-[#4A4A48]">店舗名</th>
            <th class="px-4 py-3 text-left text-sm font-semibold text-[#4A4A48]">業態</th>
            <th class="px-4 py-3 text-left text-sm font-semibold text-[#4A4A48]">オーナー名</th>
            <th class="px-4 py-3 text-left text-sm font-semibold text-[#4A4A48]">メール</th>
            <th class="px-4 py-3 text-left text-sm font-semibold text-[#4A4A48]">電話</th>
            <th class="px-4 py-3 text-left text-sm font-semibold text-[#4A4A48]">権限</th>
            <th class="px-4 py-3 text-left text-sm font-semibold text-[#4A4A48]">登録日</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-[#E8DCC4]">
          ${customers.map(customer => `
            <tr class="hover:bg-[#FFFEF9]">
              <td class="px-4 py-3 text-sm text-[#4A4A48]">${customer.id}</td>
              <td class="px-4 py-3 text-sm text-[#4A4A48] font-semibold">${customer.username}</td>
              <td class="px-4 py-3 text-sm text-[#4A4A48]">${customer.business_name}</td>
              <td class="px-4 py-3 text-sm">
                <span class="px-2 py-1 rounded-full text-xs ${customer.business_type === 'パン屋' ? 'bg-[#F5E6D3] text-[#8B6F47]' : 'bg-[#E8DCC4] text-[#6B7F5C]'}">
                  ${customer.business_type}
                </span>
              </td>
              <td class="px-4 py-3 text-sm text-[#4A4A48]">${customer.owner_name}</td>
              <td class="px-4 py-3 text-sm text-[#8B6F47]">${customer.email}</td>
              <td class="px-4 py-3 text-sm text-[#8B6F47]">${customer.phone || '-'}</td>
              <td class="px-4 py-3 text-sm">
                <span class="px-2 py-1 rounded-full text-xs ${customer.role === 'admin' ? 'bg-[#B88A5A] text-white' : 'bg-gray-200 text-gray-700'}">
                  ${customer.role === 'admin' ? '管理者' : '一般'}
                </span>
              </td>
              <td class="px-4 py-3 text-sm text-[#8B6F47]">${new Date(customer.created_at).toLocaleDateString('ja-JP')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (error) {
    console.error('Failed to load customers:', error);
    if (error.response?.status === 403) {
      container.innerHTML = '<p class="text-center text-red-500 py-8"><i class="fas fa-lock mr-2"></i>管理者権限が必要です</p>';
    } else {
      container.innerHTML = '<p class="text-center text-red-500 py-8">顧客情報の読み込みに失敗しました</p>';
    }
  }
}

// 注文状況一覧を読み込む
async function loadOrders() {
  const container = document.getElementById('ordersList');
  container.innerHTML = '<p class="text-center text-[#8B6F47] py-8"><i class="fas fa-spinner fa-spin mr-2"></i>読み込み中...</p>';
  
  try {
    const response = await axios.get('/api/admin/orders');
    const orders = response.data.orders;
    
    if (orders.length === 0) {
      container.innerHTML = '<p class="text-center text-[#8B6F47] py-8">注文情報がありません</p>';
      return;
    }
    
    container.innerHTML = `
      <table class="w-full">
        <thead class="bg-[#F5F3EE]">
          <tr>
            <th class="px-4 py-3 text-left text-sm font-semibold text-[#4A4A48]">注文ID</th>
            <th class="px-4 py-3 text-left text-sm font-semibold text-[#4A4A48]">顧客名</th>
            <th class="px-4 py-3 text-left text-sm font-semibold text-[#4A4A48]">メール</th>
            <th class="px-4 py-3 text-left text-sm font-semibold text-[#4A4A48]">電話</th>
            <th class="px-4 py-3 text-left text-sm font-semibold text-[#4A4A48]">商品数</th>
            <th class="px-4 py-3 text-right text-sm font-semibold text-[#4A4A48]">合計金額</th>
            <th class="px-4 py-3 text-left text-sm font-semibold text-[#4A4A48]">注文日時</th>
            <th class="px-4 py-3 text-center text-sm font-semibold text-[#4A4A48]">操作</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-[#E8DCC4]">
          ${orders.map(order => `
            <tr class="hover:bg-[#FFFEF9]">
              <td class="px-4 py-3 text-sm text-[#4A4A48] font-semibold">#${order.id}</td>
              <td class="px-4 py-3 text-sm text-[#4A4A48]">${order.customer_name}</td>
              <td class="px-4 py-3 text-sm text-[#8B6F47]">${order.customer_email}</td>
              <td class="px-4 py-3 text-sm text-[#8B6F47]">${order.customer_phone || '-'}</td>
              <td class="px-4 py-3 text-sm text-[#4A4A48]">${order.item_count}点</td>
              <td class="px-4 py-3 text-sm text-right font-bold text-[#B88A5A]">¥${order.total_amount.toLocaleString()}</td>
              <td class="px-4 py-3 text-sm text-[#8B6F47]">${new Date(order.created_at).toLocaleString('ja-JP')}</td>
              <td class="px-4 py-3 text-center">
                <button onclick="viewOrderDetail(${order.id})" class="text-[#B88A5A] hover:text-[#8B6F47]">
                  <i class="fas fa-eye"></i>
                </button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (error) {
    console.error('Failed to load orders:', error);
    if (error.response?.status === 403) {
      container.innerHTML = '<p class="text-center text-red-500 py-8"><i class="fas fa-lock mr-2"></i>管理者権限が必要です</p>';
    } else {
      container.innerHTML = '<p class="text-center text-red-500 py-8">注文情報の読み込みに失敗しました</p>';
    }
  }
}

// 注文詳細を表示
async function viewOrderDetail(orderId) {
  try {
    const response = await axios.get(`/api/admin/orders/${orderId}`);
    const { order, items } = response.data;
    
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4';
    modal.onclick = (e) => {
      if (e.target === modal) modal.remove();
    };
    
    modal.innerHTML = '<div class="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto p-6">' +
      '<div class="flex justify-between items-center mb-6">' +
        '<h3 class="text-2xl font-bold heading-elegant text-[#4A4A48]">注文詳細 #' + order.id + '</h3>' +
        '<button onclick="this.closest(\'.fixed\').remove()" class="w-10 h-10 rounded-full bg-[#F5F3EE] hover:bg-[#E8DCC4] flex items-center justify-center text-[#8B6F47]">' +
          '<i class="fas fa-times"></i>' +
        '</button>' +
      '</div>' +
      '<div class="space-y-4">' +
        '<div class="grid grid-cols-2 gap-4">' +
          '<div>' +
            '<p class="text-sm text-[#8B6F47] mb-1">顧客名</p>' +
            '<p class="font-semibold text-[#4A4A48]">' + order.customer_name + '</p>' +
          '</div>' +
          '<div>' +
            '<p class="text-sm text-[#8B6F47] mb-1">メール</p>' +
            '<p class="text-[#4A4A48]">' + order.customer_email + '</p>' +
          '</div>' +
          '<div>' +
            '<p class="text-sm text-[#8B6F47] mb-1">電話</p>' +
            '<p class="text-[#4A4A48]">' + (order.customer_phone || '-') + '</p>' +
          '</div>' +
          '<div>' +
            '<p class="text-sm text-[#8B6F47] mb-1">注文日時</p>' +
            '<p class="text-[#4A4A48]">' + new Date(order.created_at).toLocaleString('ja-JP') + '</p>' +
          '</div>' +
        '</div>' +
        (order.notes ? 
          '<div>' +
            '<p class="text-sm text-[#8B6F47] mb-1">備考</p>' +
            '<p class="text-[#4A4A48]">' + order.notes + '</p>' +
          '</div>'
        : '') +
        '<div class="border-t border-[#E8DCC4] pt-4">' +
          '<h4 class="font-bold text-[#4A4A48] mb-3">注文商品</h4>' +
          '<div class="space-y-2">' +
            items.map(item => 
              '<div class="flex justify-between items-center p-3 bg-[#FFFEF9] rounded-lg">' +
                '<div>' +
                  '<p class="font-semibold text-[#4A4A48]">' + item.ingredient_name + '</p>' +
                  '<p class="text-sm text-[#8B6F47]">' + item.quantity + ' × ¥' + item.price_per_unit.toLocaleString() + '</p>' +
                '</div>' +
                '<p class="font-bold text-[#B88A5A]">¥' + item.subtotal.toLocaleString() + '</p>' +
              '</div>'
            ).join('') +
          '</div>' +
        '</div>' +
        '<div class="border-t border-[#E8DCC4] pt-4 flex justify-between items-center">' +
          '<p class="text-lg font-bold text-[#4A4A48]">合計金額</p>' +
          '<p class="text-2xl font-bold heading-elegant text-[#B88A5A]">¥' + order.total_amount.toLocaleString() + '</p>' +
        '</div>' +
      '</div>' +
    '</div>';
    
    document.body.appendChild(modal);
  } catch (error) {
    console.error('Failed to load order detail:', error);
    alert('注文詳細の読み込みに失敗しました');
  }
}

