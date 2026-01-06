import streamlit as st
import pandas as pd
import numpy as np
from janome.tokenizer import Tokenizer
from wordcloud import WordCloud
import matplotlib.pyplot as plt
import japanize_matplotlib
import seaborn as sns
import networkx as nx
import plotly.graph_objects as go
from collections import Counter, defaultdict
from itertools import combinations
import io
from docx import Document
import openpyxl
import re

# ページ設定
st.set_page_config(
    page_title="テキスト分析アプリケーション",
    page_icon="📊",
    layout="wide"
)

# セッションステートの初期化
if 'analyzed_data' not in st.session_state:
    st.session_state.analyzed_data = None
if 'tokens' not in st.session_state:
    st.session_state.tokens = []

class TextAnalyzer:
    def __init__(self):
        self.tokenizer = Tokenizer()
        # ポジティブ・ネガティブ辞書（簡易版）
        self.positive_words = set([
            '良い', 'すばらしい', '素晴らしい', '最高', '嬉しい', '楽しい', '幸せ', 
            '満足', '快適', '美しい', '優れる', '素敵', '最適', '効果的', '便利',
            '好き', '愛', '感謝', '喜び', '成功', '達成', '素晴らしき', '安心',
            '快い', '明るい', '正しい', '新しい', '清潔', '安全', '健康', '活発'
        ])
        self.negative_words = set([
            '悪い', 'ひどい', '酷い', '最悪', '悲しい', '辛い', '苦しい', '不満',
            '不快', '醜い', '劣る', '嫌い', '憎い', '失敗', '不安', '心配',
            '暗い', '汚い', '危険', '病気', '困る', '問題', '難しい', '面倒',
            '疲れる', '痛い', '弱い', '下手', '残念', '後悔', '怒り', '恐い'
        ])
        
        # ストップワード
        self.stop_words = set([
            'する', 'ある', 'いる', 'なる', 'れる', 'られる', 'せる', 
            'させる', 'くれる', 'やる', 'くださる', 'いく', '来る',
            'こと', 'もの', 'の', 'ん', 'これ', 'それ', 'あれ', 'どれ',
            'ため', 'よう', 'など', 'さん', 'ちゃん', 'くん'
        ])
    
    def extract_text_from_docx(self, file):
        """Wordファイルからテキストを抽出"""
        doc = Document(file)
        text = '\n'.join([paragraph.text for paragraph in doc.paragraphs])
        return text
    
    def extract_text_from_excel(self, file):
        """Excelファイルからテキストを抽出"""
        df = pd.read_excel(file)
        # すべての列を結合
        text = ' '.join(df.astype(str).values.flatten())
        return text
    
    def extract_text_from_csv(self, file):
        """CSVファイルからテキストを抽出"""
        df = pd.read_csv(file)
        # すべての列を結合
        text = ' '.join(df.astype(str).values.flatten())
        return text
    
    def tokenize(self, text, pos_filter=None):
        """形態素解析を実施"""
        tokens = []
        for token in self.tokenizer.tokenize(text):
            parts = token.split('\t')
            if len(parts) < 2:
                continue
            
            surface = parts[0]
            features = parts[1].split(',')
            pos = features[0]  # 品詞
            base_form = features[6] if len(features) > 6 else surface
            
            # 品詞フィルタ
            if pos_filter and pos not in pos_filter:
                continue
            
            # ストップワード除去
            if base_form in self.stop_words:
                continue
            
            # 1文字の単語を除外
            if len(surface) <= 1:
                continue
            
            tokens.append({
                'surface': surface,
                'pos': pos,
                'base_form': base_form
            })
        
        return tokens
    
    def sentiment_analysis(self, tokens):
        """センチメント分析"""
        positive_count = 0
        negative_count = 0
        neutral_count = 0
        
        sentiment_words = []
        
        for token in tokens:
            base_form = token['base_form']
            if base_form in self.positive_words:
                positive_count += 1
                sentiment_words.append((base_form, 'positive'))
            elif base_form in self.negative_words:
                negative_count += 1
                sentiment_words.append((base_form, 'negative'))
            else:
                neutral_count += 1
        
        total = positive_count + negative_count + neutral_count
        
        if total == 0:
            return {
                'positive': 0,
                'negative': 0,
                'neutral': 0,
                'score': 0,
                'sentiment_words': []
            }
        
        # センチメントスコア（-1から1の範囲）
        score = (positive_count - negative_count) / total if total > 0 else 0
        
        return {
            'positive': positive_count,
            'negative': negative_count,
            'neutral': neutral_count,
            'positive_ratio': positive_count / total,
            'negative_ratio': negative_count / total,
            'neutral_ratio': neutral_count / total,
            'score': score,
            'sentiment_words': sentiment_words
        }
    
    def create_wordcloud(self, tokens, max_words=100):
        """Wordcloudを生成"""
        # 基本形で集計
        words = [token['base_form'] for token in tokens]
        text = ' '.join(words)
        
        if not text.strip():
            return None
        
        # 日本語フォントのパス
        font_path = '/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf'
        try:
            wordcloud = WordCloud(
                font_path=font_path,
                width=800,
                height=400,
                background_color='white',
                max_words=max_words,
                colormap='viridis'
            ).generate(text)
        except Exception as e:
            # フォントが見つからない場合のフォールバック
            st.warning(f"日本語フォントでの生成に失敗しました: {e}")
            wordcloud = WordCloud(
                width=800,
                height=400,
                background_color='white',
                max_words=max_words,
                colormap='viridis'
            ).generate(text)
        
        return wordcloud
    
    def cooccurrence_network(self, text, window_size=5, min_count=2):
        """共起ネットワーク分析"""
        # 文章を文に分割
        sentences = re.split('[。．\n]', text)
        
        # 共起カウント
        cooccurrence = defaultdict(int)
        word_count = defaultdict(int)
        
        for sentence in sentences:
            if not sentence.strip():
                continue
            
            tokens = self.tokenize(sentence, pos_filter=['名詞', '動詞', '形容詞'])
            words = [token['base_form'] for token in tokens]
            
            # 単語カウント
            for word in words:
                word_count[word] += 1
            
            # ウィンドウ内の共起をカウント
            for i, word1 in enumerate(words):
                start = max(0, i - window_size)
                end = min(len(words), i + window_size + 1)
                for j in range(start, end):
                    if i != j:
                        word2 = words[j]
                        pair = tuple(sorted([word1, word2]))
                        cooccurrence[pair] += 1
        
        # 最小出現回数でフィルタリング
        filtered_cooccurrence = {
            pair: count for pair, count in cooccurrence.items()
            if count >= min_count and 
            word_count[pair[0]] >= min_count and 
            word_count[pair[1]] >= min_count
        }
        
        return filtered_cooccurrence, word_count
    
    def create_network_graph(self, cooccurrence, word_count, top_n=30):
        """ネットワークグラフを作成"""
        if not cooccurrence:
            return None
        
        # グラフの作成
        G = nx.Graph()
        
        # エッジを追加（重みは共起回数）
        for (word1, word2), count in sorted(cooccurrence.items(), key=lambda x: x[1], reverse=True)[:top_n]:
            G.add_edge(word1, word2, weight=count)
        
        if len(G.nodes()) == 0:
            return None
        
        # レイアウトの計算
        pos = nx.spring_layout(G, k=0.5, iterations=50)
        
        # エッジの描画
        edge_trace = []
        for edge in G.edges():
            x0, y0 = pos[edge[0]]
            x1, y1 = pos[edge[1]]
            weight = G[edge[0]][edge[1]]['weight']
            edge_trace.append(
                go.Scatter(
                    x=[x0, x1, None],
                    y=[y0, y1, None],
                    mode='lines',
                    line=dict(width=weight * 0.5, color='#888'),
                    hoverinfo='none',
                    showlegend=False
                )
            )
        
        # ノードの描画
        node_x = []
        node_y = []
        node_text = []
        node_size = []
        
        for node in G.nodes():
            x, y = pos[node]
            node_x.append(x)
            node_y.append(y)
            node_text.append(f'{node}<br>出現回数: {word_count[node]}')
            node_size.append(word_count[node] * 2)
        
        node_trace = go.Scatter(
            x=node_x,
            y=node_y,
            mode='markers+text',
            text=[node for node in G.nodes()],
            textposition='top center',
            hovertext=node_text,
            hoverinfo='text',
            marker=dict(
                size=node_size,
                color='lightblue',
                line=dict(width=2, color='darkblue')
            ),
            showlegend=False
        )
        
        # 図の作成
        fig = go.Figure(data=edge_trace + [node_trace],
                       layout=go.Layout(
                           title='共起ネットワーク',
                           showlegend=False,
                           hovermode='closest',
                           margin=dict(b=0, l=0, r=0, t=40),
                           xaxis=dict(showgrid=False, zeroline=False, showticklabels=False),
                           yaxis=dict(showgrid=False, zeroline=False, showticklabels=False),
                           height=600
                       ))
        
        return fig


def main():
    st.title("📊 テキスト分析アプリケーション")
    st.markdown("""
    このアプリケーションでは、Word、Excel、CSVファイルから文章データを読み込み、
    以下の分析を実施します：
    - 📝 形態素解析
    - 💭 センチメント分析
    - ☁️ Wordcloud生成
    - 🕸️ 共起ネットワーク分析
    """)
    
    # サイドバー
    st.sidebar.header("設定")
    
    # ファイルアップロード
    uploaded_file = st.sidebar.file_uploader(
        "ファイルをアップロード",
        type=['docx', 'xlsx', 'csv', 'txt']
    )
    
    analyzer = TextAnalyzer()
    
    if uploaded_file is not None:
        # ファイルタイプに応じてテキストを抽出
        try:
            if uploaded_file.name.endswith('.docx'):
                text = analyzer.extract_text_from_docx(uploaded_file)
            elif uploaded_file.name.endswith('.xlsx'):
                text = analyzer.extract_text_from_excel(uploaded_file)
            elif uploaded_file.name.endswith('.csv'):
                text = analyzer.extract_text_from_csv(uploaded_file)
            else:  # txt
                text = uploaded_file.read().decode('utf-8')
            
            st.success(f"✅ ファイル '{uploaded_file.name}' を読み込みました")
            
            # テキストプレビュー
            with st.expander("📄 テキストプレビュー"):
                st.text_area("読み込んだテキスト", text[:1000] + "..." if len(text) > 1000 else text, height=200)
            
            # 分析実行ボタン
            if st.sidebar.button("🔍 分析を実行", type="primary"):
                with st.spinner("分析中..."):
                    # 形態素解析
                    tokens = analyzer.tokenize(text, pos_filter=['名詞', '動詞', '形容詞', '副詞'])
                    st.session_state.tokens = tokens
                    
                    # 基本統計
                    st.header("📊 基本統計")
                    col1, col2, col3, col4 = st.columns(4)
                    
                    with col1:
                        st.metric("総文字数", len(text))
                    with col2:
                        st.metric("総単語数", len(tokens))
                    with col3:
                        unique_words = len(set([t['base_form'] for t in tokens]))
                        st.metric("ユニーク単語数", unique_words)
                    with col4:
                        if len(tokens) > 0:
                            st.metric("語彙の豊かさ", f"{unique_words / len(tokens):.2%}")
                        else:
                            st.metric("語彙の豊かさ", "N/A")
                    
                    # 頻出単語
                    st.header("📈 頻出単語")
                    word_freq = Counter([token['base_form'] for token in tokens])
                    top_words = word_freq.most_common(20)
                    
                    if top_words:
                        df_freq = pd.DataFrame(top_words, columns=['単語', '出現回数'])
                        
                        col1, col2 = st.columns([1, 1])
                        
                        with col1:
                            st.dataframe(df_freq, use_container_width=True)
                        
                        with col2:
                            fig, ax = plt.subplots(figsize=(10, 6))
                            ax.barh(range(len(top_words)), [count for _, count in top_words])
                            ax.set_yticks(range(len(top_words)))
                            ax.set_yticklabels([word for word, _ in top_words])
                            ax.invert_yaxis()
                            ax.set_xlabel('出現回数')
                            ax.set_title('頻出単語トップ20')
                            st.pyplot(fig)
                    
                    # センチメント分析
                    st.header("💭 センチメント分析")
                    sentiment_result = analyzer.sentiment_analysis(tokens)
                    
                    col1, col2, col3 = st.columns(3)
                    
                    with col1:
                        st.metric("ポジティブ単語", sentiment_result['positive'])
                    with col2:
                        st.metric("ネガティブ単語", sentiment_result['negative'])
                    with col3:
                        st.metric("センチメントスコア", f"{sentiment_result['score']:.3f}")
                    
                    # センチメント比率の円グラフ
                    if sentiment_result['positive'] + sentiment_result['negative'] + sentiment_result['neutral'] > 0:
                        fig, ax = plt.subplots(figsize=(8, 6))
                        sizes = [
                            sentiment_result['positive'],
                            sentiment_result['negative'],
                            sentiment_result['neutral']
                        ]
                        labels = ['ポジティブ', 'ネガティブ', 'ニュートラル']
                        colors = ['#90EE90', '#FFB6C6', '#D3D3D3']
                        ax.pie(sizes, labels=labels, colors=colors, autopct='%1.1f%%', startangle=90)
                        ax.set_title('感情の分布')
                        st.pyplot(fig)
                    
                    # 感情を持つ単語のリスト
                    if sentiment_result['sentiment_words']:
                        with st.expander("感情を持つ単語の詳細"):
                            positive_words = [word for word, sentiment in sentiment_result['sentiment_words'] if sentiment == 'positive']
                            negative_words = [word for word, sentiment in sentiment_result['sentiment_words'] if sentiment == 'negative']
                            
                            col1, col2 = st.columns(2)
                            with col1:
                                st.write("**ポジティブ単語:**")
                                st.write(", ".join(set(positive_words)))
                            with col2:
                                st.write("**ネガティブ単語:**")
                                st.write(", ".join(set(negative_words)))
                    
                    # Wordcloud
                    st.header("☁️ Wordcloud")
                    max_words = st.sidebar.slider("最大表示単語数", 50, 200, 100)
                    
                    wordcloud = analyzer.create_wordcloud(tokens, max_words=max_words)
                    if wordcloud:
                        fig, ax = plt.subplots(figsize=(12, 6))
                        ax.imshow(wordcloud, interpolation='bilinear')
                        ax.axis('off')
                        st.pyplot(fig)
                    else:
                        st.warning("Wordcloudを生成できませんでした。")
                    
                    # 共起ネットワーク
                    st.header("🕸️ 共起ネットワーク分析")
                    
                    window_size = st.sidebar.slider("共起ウィンドウサイズ", 2, 10, 5)
                    min_count = st.sidebar.slider("最小出現回数", 1, 10, 2)
                    top_n = st.sidebar.slider("表示する共起ペア数", 10, 50, 30)
                    
                    cooccurrence, word_count = analyzer.cooccurrence_network(
                        text, 
                        window_size=window_size, 
                        min_count=min_count
                    )
                    
                    if cooccurrence:
                        # 共起頻度トップ10
                        st.subheader("共起頻度トップ10")
                        top_cooccurrence = sorted(cooccurrence.items(), key=lambda x: x[1], reverse=True)[:10]
                        df_cooccurrence = pd.DataFrame(
                            [(f"{pair[0]} - {pair[1]}", count) for pair, count in top_cooccurrence],
                            columns=['単語ペア', '共起回数']
                        )
                        st.dataframe(df_cooccurrence, use_container_width=True)
                        
                        # ネットワークグラフ
                        st.subheader("共起ネットワークグラフ")
                        network_fig = analyzer.create_network_graph(cooccurrence, word_count, top_n=top_n)
                        if network_fig:
                            st.plotly_chart(network_fig, use_container_width=True)
                        else:
                            st.warning("ネットワークグラフを生成できませんでした。")
                    else:
                        st.warning("共起データが見つかりませんでした。パラメータを調整してください。")
                    
                    st.success("✅ 分析が完了しました！")
        
        except Exception as e:
            st.error(f"エラーが発生しました: {str(e)}")
            import traceback
            st.code(traceback.format_exc())
    
    else:
        st.info("👈 サイドバーからファイルをアップロードしてください")
        
        # サンプルテキストで試す
        st.markdown("---")
        st.subheader("サンプルテキストで試す")
        
        sample_text = st.text_area(
            "テキストを入力してください",
            "今日は本当に素晴らしい天気で、公園で楽しく遊びました。子供たちも大喜びで、とても幸せな一日でした。"
            "しかし、帰り道で少し疲れてしまい、少し残念な気持ちになりました。",
            height=150
        )
        
        if st.button("サンプルテキストを分析", type="secondary"):
            with st.spinner("分析中..."):
                tokens = analyzer.tokenize(sample_text, pos_filter=['名詞', '動詞', '形容詞', '副詞'])
                
                st.subheader("形態素解析結果")
                df_tokens = pd.DataFrame(tokens)
                st.dataframe(df_tokens.head(20), use_container_width=True)
                
                st.subheader("センチメント分析結果")
                sentiment_result = analyzer.sentiment_analysis(tokens)
                col1, col2, col3 = st.columns(3)
                with col1:
                    st.metric("ポジティブ", sentiment_result['positive'])
                with col2:
                    st.metric("ネガティブ", sentiment_result['negative'])
                with col3:
                    st.metric("スコア", f"{sentiment_result['score']:.3f}")


if __name__ == "__main__":
    main()
