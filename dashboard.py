import streamlit as st
import sqlite3
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from datetime import datetime

# ==========================================
# PAGE CONFIG & CUSTOM STYLING
# ==========================================
st.set_page_config(
    page_title="CineVault — Analytics Dashboard",
    page_icon="🎬",
    layout="wide",
    initial_sidebar_state="expanded"
)

# Custom CSS for dark-themed, premium look
st.markdown("""
<style>
    /* Dark theme customizations */
    .stApp {
        background-color: #0d0d12;
        color: #e2e8f0;
    }
    div[data-testid="stMetricValue"] {
        font-size: 2.2rem;
        font-weight: 800;
        background: linear-gradient(135deg, #a78bfa, #8b5cf6);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
    }
    div[data-testid="stMetricLabel"] {
        color: #94a3b8;
        font-weight: 600;
    }
    .main-title {
        font-size: 2.8rem;
        font-weight: 900;
        margin-bottom: 0px;
        background: linear-gradient(135deg, #a78bfa, #7c3aed, #4c1d95);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
    }
    .subtitle {
        color: #94a3b8;
        font-size: 1.1rem;
        margin-bottom: 24px;
    }
    .card {
        background-color: #161622;
        border: 1px solid #2e2e3f;
        padding: 20px;
        border-radius: 12px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    }
    .poster-container {
        border-radius: 10px;
        overflow: hidden;
        border: 2px solid #2e2e3f;
    }
    .badge {
        background-color: #7c3aed;
        color: white;
        padding: 4px 10px;
        border-radius: 99px;
        font-size: 0.8rem;
        font-weight: bold;
        display: inline-block;
        margin-right: 6px;
    }
</style>
""", unsafe_allow_html=True)

# ==========================================
# DATABASE HELPERS
# ==========================================
def get_connection():
    return sqlite3.connect("cinevault.db")

@st.cache_data
def load_genres():
    conn = get_connection()
    df = pd.read_sql_query("SELECT DISTINCT genre FROM genres WHERE genre IS NOT NULL AND genre != '' ORDER BY genre ASC", conn)
    conn.close()
    return df['genre'].tolist()

@st.cache_data
def load_languages():
    conn = get_connection()
    df = pd.read_sql_query("SELECT DISTINCT original_language FROM content WHERE original_language IS NOT NULL AND original_language != '' ORDER BY original_language ASC", conn)
    conn.close()
    return df['original_language'].tolist()

@st.cache_data
def get_year_range():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT 
            MIN(CAST(SUBSTR(release_date, 1, 4) AS INTEGER)), 
            MAX(CAST(SUBSTR(release_date, 1, 4) AS INTEGER)) 
        FROM content 
        WHERE release_date IS NOT NULL AND release_date != ''
    """)
    res = cursor.fetchone()
    conn.close()
    min_y = res[0] if res[0] and res[0] > 1900 else 1900
    max_y = res[1] if res[1] and res[1] < 2100 else datetime.now().year
    return int(min_y), int(max_y)

def load_filtered_data(content_type, min_year, max_year, min_rating, selected_genres, selected_langs, search_query):
    conn = get_connection()
    conditions = []
    params = []
    
    if content_type != "All":
        conditions.append("content_type = ?")
        params.append(content_type.lower())
        
    conditions.append("CAST(SUBSTR(release_date, 1, 4) AS INTEGER) BETWEEN ? AND ?")
    params.extend([min_year, max_year])
    
    conditions.append("vote_average >= ?")
    params.append(min_rating)
    
    if selected_langs:
        placeholders = ",".join(["?"] * len(selected_langs))
        conditions.append(f"original_language IN ({placeholders})")
        params.extend(selected_langs)
        
    if selected_genres:
        placeholders = ",".join(["?"] * len(selected_genres))
        conditions.append(f"id IN (SELECT content_id FROM genres WHERE genre IN ({placeholders}))")
        params.extend(selected_genres)
        
    if search_query:
        conditions.append("(title LIKE ? OR original_title LIKE ?)")
        params.extend([f"%{search_query}%", f"%{search_query}%"])
        
    where_clause = " WHERE " + " AND ".join(conditions) if conditions else ""
    query = f"SELECT * FROM content {where_clause} ORDER BY popularity DESC"
    df = pd.read_sql_query(query, conn, params=params)
    
    # Fetch matching genres for these ids
    if not df.empty:
        ids = df['id'].tolist()
        chunk_size = 999
        genres_df_list = []
        for i in range(0, len(ids), chunk_size):
            chunk_ids = ids[i:i+chunk_size]
            placeholders = ",".join(["?"] * len(chunk_ids))
            g_query = f"SELECT content_id, genre FROM genres WHERE content_id IN ({placeholders})"
            g_df = pd.read_sql_query(g_query, conn, params=chunk_ids)
            genres_df_list.append(g_df)
        genres_df = pd.concat(genres_df_list, ignore_index=True) if genres_df_list else pd.DataFrame(columns=['content_id', 'genre'])
    else:
        genres_df = pd.DataFrame(columns=['content_id', 'genre'])
        
    conn.close()
    return df, genres_df

# ==========================================
# SIDEBAR FILTERS
# ==========================================
st.sidebar.image("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='80'>🎬</text></svg>", width=80)
st.sidebar.markdown("### CineVault Filters")

# Content Type Selector
content_type = st.sidebar.selectbox(
    "Content Type",
    options=["All", "Movie", "Anime"],
    index=0
)

# Year Range Slider
min_y_limit, max_y_limit = get_year_range()
year_range = st.sidebar.slider(
    "Release Year Range",
    min_value=min_y_limit,
    max_value=max_y_limit,
    value=(max(min_y_limit, 1990), max_y_limit)
)

# Rating Slider
min_rating = st.sidebar.slider(
    "Minimum Rating",
    min_value=0.0,
    max_value=10.0,
    value=5.0,
    step=0.5
)

# Dynamic Genres filter
available_genres = load_genres()
selected_genres = st.sidebar.multiselect(
    "Genres",
    options=available_genres,
    default=[]
)

# Dynamic Languages filter
available_langs = load_languages()
selected_langs = st.sidebar.multiselect(
    "Original Language",
    options=available_langs,
    default=[]
)

# Text Search
search_query = st.sidebar.text_input("Title Search", value="", placeholder="Search by title...")

# Clear Filters button
if st.sidebar.button("Reset Filters"):
    st.experimental_rerun()

# ==========================================
# MAIN DASHBOARD CONTENT
# ==========================================
st.markdown("<h1 class='main-title'>🎬 CineVault Dashboard</h1>", unsafe_allow_html=True)
st.markdown("<p class='subtitle'>Real-time datasets analysis, interactive plots, and catalogs browser.</p>", unsafe_allow_html=True)

# Load current filtered dataset
df, genres_df = load_filtered_data(
    content_type, 
    year_range[0], 
    year_range[1], 
    min_rating, 
    selected_genres, 
    selected_langs, 
    search_query
)

if df.empty:
    st.warning("⚠️ No movies or anime match your current filter settings. Try adjusting the sidebar filters.")
else:
    # ------------------------------------------
    # KPI METRICS SECTION
    # ------------------------------------------
    col1, col2, col3, col4 = st.columns(4)
    
    total_titles = len(df)
    avg_rating = df['vote_average'].mean()
    avg_popularity = df['popularity'].mean()
    
    # Calculate total revenue / budget
    movies_df = df[df['content_type'] == 'movie']
    total_revenue = movies_df['revenue'].sum() if not movies_df.empty else 0
    total_budget = movies_df['budget'].sum() if not movies_df.empty else 0
    
    with col1:
        st.metric(label="Total Titles", value=f"{total_titles:,}")
    with col2:
        st.metric(label="Average Rating", value=f"{avg_rating:.2f} / 10")
    with col3:
        st.metric(label="Average Popularity", value=f"{avg_popularity:.1f}")
    with col4:
        if content_type == "Anime":
            total_episodes = int(df['episodes'].fillna(0).sum())
            st.metric(label="Total Episodes", value=f"{total_episodes:,}")
        else:
            st.metric(label="Total Movie Revenue", value=f"${total_revenue:,.0f}" if total_revenue > 0 else "N/A")

    st.markdown("---")

    # ------------------------------------------
    # PLOTS & DATA VISUALIZATION
    # ------------------------------------------
    plot_col1, plot_col2 = st.columns(2)
    
    with plot_col1:
        st.markdown("### 📊 Top Genres Distribution")
        if not genres_df.empty:
            genre_counts = genres_df['genre'].value_counts().reset_index()
            genre_counts.columns = ['Genre', 'Count']
            
            fig_genres = px.bar(
                genre_counts.head(15), 
                y='Genre', 
                x='Count', 
                orientation='h',
                color='Count',
                color_continuous_scale=px.colors.sequential.Purples,
                template="plotly_dark"
            )
            fig_genres.update_layout(
                yaxis={'categoryorder':'total ascending'},
                paper_bgcolor='rgba(0,0,0,0)',
                plot_bgcolor='rgba(0,0,0,0)',
                margin=dict(l=20, r=20, t=20, b=20),
                height=350
            )
            st.plotly_chart(fig_genres, use_container_width=True)
        else:
            st.info("No genre data available for current selection.")

    with plot_col2:
        st.markdown("### 📈 Release Trends Over Time")
        # Extract year
        df['release_year'] = pd.to_datetime(df['release_date'], errors='coerce').dt.year
        df_years = df[df['release_year'].notna()]
        if not df_years.empty:
            year_counts = df_years.groupby(['release_year', 'content_type']).size().reset_index(name='Count')
            fig_years = px.line(
                year_counts, 
                x='release_year', 
                y='Count', 
                color='content_type',
                color_discrete_map={'movie': '#a78bfa', 'anime': '#f43f5e'},
                template="plotly_dark"
            )
            fig_years.update_layout(
                paper_bgcolor='rgba(0,0,0,0)',
                plot_bgcolor='rgba(0,0,0,0)',
                xaxis_title="Year",
                yaxis_title="Titles Count",
                margin=dict(l=20, r=20, t=20, b=20),
                height=350
            )
            st.plotly_chart(fig_years, use_container_width=True)
        else:
            st.info("No release year data available.")

    plot_col3, plot_col4 = st.columns(2)

    with plot_col3:
        st.markdown("### 🔮 Popularity vs Rating Correlation")
        fig_scatter = px.scatter(
            df,
            x="vote_average",
            y="popularity",
            color="content_type",
            hover_name="title",
            color_discrete_map={'movie': '#8b5cf6', 'anime': '#ec4899'},
            size="vote_count",
            size_max=35,
            opacity=0.7,
            template="plotly_dark",
            labels={"vote_average": "Vote Rating", "popularity": "Popularity Score"}
        )
        fig_scatter.update_layout(
            paper_bgcolor='rgba(0,0,0,0)',
            plot_bgcolor='rgba(0,0,0,0)',
            margin=dict(l=20, r=20, t=20, b=20),
            height=350
        )
        st.plotly_chart(fig_scatter, use_container_width=True)

    with plot_col4:
        st.markdown("### 💰 Budget vs Revenue (Movies)")
        # Filter movies with valid financial data
        financials = df[(df['content_type'] == 'movie') & (df['budget'] > 0) & (df['revenue'] > 0)]
        if not financials.empty:
            fig_finance = px.scatter(
                financials,
                x="budget",
                y="revenue",
                hover_name="title",
                color="vote_average",
                color_continuous_scale="Viridis",
                size="popularity",
                size_max=30,
                opacity=0.8,
                template="plotly_dark",
                labels={"budget": "Budget ($)", "revenue": "Revenue ($)"}
            )
            fig_finance.update_layout(
                paper_bgcolor='rgba(0,0,0,0)',
                plot_bgcolor='rgba(0,0,0,0)',
                margin=dict(l=20, r=20, t=20, b=20),
                height=350
            )
            st.plotly_chart(fig_finance, use_container_width=True)
        else:
            st.info("No budget vs revenue financial data available for the current selection (Only applicable for movies with positive budget & revenue).")

    st.markdown("---")

    # ------------------------------------------
    # INTERACTIVE EXPLORER & DETAIL PANEL
    # ------------------------------------------
    st.markdown("### 🔍 Interactive Content Explorer")
    
    exp_col1, exp_col2 = st.columns([3, 2])
    
    with exp_col1:
        st.markdown("##### Browse Current Results")
        # Format columns for displays
        display_df = df[['title', 'content_type', 'release_date', 'vote_average', 'popularity', 'original_language']].copy()
        display_df.columns = ['Title', 'Type', 'Release Date', 'Rating', 'Popularity', 'Lang']
        
        st.dataframe(
            display_df,
            use_container_width=True,
            height=400,
            hide_index=True
        )
        
    with exp_col2:
        st.markdown("##### Detailed Title Inspect Card")
        # Let user pick a title to inspect
        title_options = df['title'].tolist()
        selected_title = st.selectbox(
            "Select a title to view details:",
            options=title_options,
            index=0
        )
        
        if selected_title:
            title_row = df[df['title'] == selected_title].iloc[0]
            title_id = title_row['id']
            title_genres = genres_df[genres_df['content_id'] == title_id]['genre'].tolist()
            
            with st.container(border=True):
                card_col1, card_col2 = st.columns([1, 2])
                
                with card_col1:
                    poster = title_row['poster_url']
                    if poster and isinstance(poster, str) and (poster.startswith('http') or poster.startswith('/')):
                        st.markdown(f"<div class='poster-container'><img src='{poster}' style='width:100%; border-radius:8px;'></div>", unsafe_allow_html=True)
                    else:
                        st.markdown("""
                        <div style="aspect-ratio: 2/3; background-color: #2e2e3f; display: flex; align-items: center; justify-content: center; border-radius: 8px; border: 1px solid #3f3f5f;">
                            <span style="font-size: 2.5rem;">🎬</span>
                        </div>
                        """, unsafe_allow_html=True)
                        
                with card_col2:
                    st.subheader(title_row['title'])
                    if title_row['tagline']:
                        st.markdown(f"*\"{title_row['tagline']}\"*")
                    
                    st.write(f"**Type:** {title_row['content_type'].capitalize()}")
                    st.write(f"**Rating:** ⭐ {title_row['vote_average']:.2f} / 10 ({int(title_row['vote_count']):,} votes)")
                    st.write(f"**Released:** {title_row['release_date']}")
                    
                    if title_row['content_type'] == 'anime':
                        st.write(f"**Episodes:** {int(title_row['episodes']) if pd.notna(title_row['episodes']) else 'N/A'}")
                    else:
                        st.write(f"**Runtime:** {int(title_row['runtime'])} mins" if pd.notna(title_row['runtime']) and title_row['runtime'] > 0 else "")
                        
                    # Genres badges
                    genres_html = "".join([f"<span class='badge'>{g}</span>" for g in title_genres])
                    st.markdown(genres_html, unsafe_allow_html=True)
                
                st.markdown("**Overview:**")
                st.write(title_row['overview'])
                
                # External Link
                if title_row['content_type'] == 'anime' and title_row['anime_link']:
                    st.markdown(f"[View on MyAnimeList ↗]({title_row['anime_link']})")
                elif title_row['content_type'] == 'movie':
                    # TMDB search link
                    tmdb_search = f"https://www.themoviedb.org/search?query={selected_title.replace(' ', '+')}"
                    st.markdown(f"[Search on TMDB ↗]({tmdb_search})")
