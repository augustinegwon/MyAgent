#tools.py
import yfinance as yf
from tavily import TavilyClient
import requests
from bs4 import BeautifulSoup
import config

# Tavily 클라이언트 설정
tavily = TavilyClient(api_key=config.TAVILY_API_KEY)

# 도구 1: 주가 확인
def get_stock_price(ticker):
    print(f"-> [도구 작동] 주가 확인: {ticker}")
    try:
        stock = yf.Ticker(ticker)
        price = stock.fast_info['last_price']
        return f"{ticker}의 현재 주가는 ${round(price, 2)}입니다."
    except Exception:
        return "주가 정보를 가져오지 못했습니다."

# 도구 2: 웹 검색
def search_web(query, max_results=3):
    print(f"-> [도구 작동] 웹 검색: {query}")
    try:
        response = tavily.search(query=query, max_results=max_results)
        return str(response['results'])
    except Exception:
        return "검색에 실패했습니다."

# 도구 3: 네이버 블로그 읽기 (새로 추가된 부분)
def read_naver_blog(url):
    print(f"-> [도구 작동] 네이버 블로그 읽기 시작: {url}")
    headers = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'}
    REQUEST_TIMEOUT = 10

    try:
        response = requests.get(url, headers=headers, timeout=REQUEST_TIMEOUT)
        soup = BeautifulSoup(response.text, 'html.parser')

        # [핵심 로직] 모바일 주소인지 PC 주소인지 판별
        if "m.blog.naver.com" in url:
            # 모바일 버전 본문 추출용 태그
            content_area = soup.select_one('.se-main-container') or soup.select_one('.post_ct')
        else:
            # PC 버전: 액자(iframe) 속으로 침투
            iframe = soup.select_one('iframe#mainFrame')
            if iframe and iframe.get('src'):
                real_url = "https://blog.naver.com" + iframe.get('src')
                response = requests.get(real_url, headers=headers, timeout=REQUEST_TIMEOUT)
                soup = BeautifulSoup(response.text, 'html.parser')
            content_area = soup.select_one('.se-main-container') or soup.select_one('#postViewArea')

        if content_area:
            text = content_area.get_text(separator='\n', strip=True)
            return text[:5000] # AI에게 전달할 핵심 내용
        else:
            return "본문 영역을 찾는 데 실패했습니다. 구조가 특이한 블로그일 수 있습니다."

    except Exception as e:
        return f"에러 발생: {str(e)}"

# 도구 4: 네이버 블로그 인기글 분석
def get_naver_blog_top_posts(blog_id, top_n=10):
    """네이버 블로그 ID → 조회수 상위 top_n 포스트 목록 + 본문 발췌 반환"""
    print(f"-> [도구 작동] 네이버 블로그 인기글 수집: {blog_id}")
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        'Referer': f'https://blog.naver.com/{blog_id}',
    }
    list_url = (
        "https://blog.naver.com/PostTitleListAsync.naver"
        f"?blogId={blog_id}&currentPage=1&categoryNo=0"
        f"&listStyle=style1&sortType=view&countPerPage={top_n}"
    )
    try:
        resp = requests.get(list_url, headers=headers, timeout=10)
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        return f"블로그 포스트 목록을 가져오지 못했습니다: {e}"

    posts = data.get('postList', [])
    if not posts:
        return f"블로그 '{blog_id}'에서 공개 포스트를 찾지 못했습니다. ID를 확인하거나 전체공개 글이 없을 수 있습니다."

    results = []
    for i, post in enumerate(posts[:top_n], 1):
        log_no = post.get('logNo')
        title = post.get('title', '제목 없음')
        read_count = post.get('readCount', 0)
        url = f"https://m.blog.naver.com/{blog_id}/{log_no}"

        content = read_naver_blog(url)
        excerpt = content[:1200]

        try:
            read_str = f"{int(read_count):,}"
        except (ValueError, TypeError):
            read_str = str(read_count)

        results.append(
            f"[{i}위] {title} (조회수: {read_str})\nURL: {url}\n{excerpt}"
        )

    return "\n\n---\n\n".join(results)
