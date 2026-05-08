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

    try:
        response = requests.get(url, headers=headers)
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
                response = requests.get(real_url, headers=headers)
                soup = BeautifulSoup(response.text, 'html.parser')
            content_area = soup.select_one('.se-main-container') or soup.select_one('#postViewArea')

        if content_area:
            text = content_area.get_text(separator='\n', strip=True)
            return text[:5000] # AI에게 전달할 핵심 내용
        else:
            return "본문 영역을 찾는 데 실패했습니다. 구조가 특이한 블로그일 수 있습니다."

    except Exception as e:
        return f"에러 발생: {str(e)}"
