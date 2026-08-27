import type { NextFunction, Request, Response } from 'express';

/**
 * API 응답 공통 보안 헤더.
 *
 * 웹(Next)은 `next.config.mjs` 의 headers() 가 담당하고, 여기는 API 오리진을 담당한다 —
 * 카카오 OAuth 시작·콜백은 **API 오리진에서 직접 열리는 top-level 문서**라(리다이렉트 302,
 * 에러 응답) 웹 쪽 헤더가 닿지 않는다.
 *
 * CSP 는 넣지 않는다. 이 서버는 비프로덕션에서 Swagger UI 를 서빙하는데, Swagger 는 인라인
 * 스크립트·스타일로 동작해서 기본 CSP 를 얹으면 문서 화면이 통째로 깨진다. 지금 막으려는
 * 것(스니핑·프레이밍·Referer 유출)은 아래 세 헤더로 충분하다.
 *
 * `helmet` 을 쓰지 않은 이유: 필요한 게 헤더 세 줄인데, helmet 기본값은 CSP 를 포함해
 * Swagger 를 깨뜨려서 결국 대부분을 꺼야 한다 — 끄는 설정이 켜는 코드보다 길어진다.
 */
export function securityHeaders() {
  return (req: Request, res: Response, next: NextFunction): void => {
    // 선언한 Content-Type 을 브라우저가 무시하고 추측하지 못하게 한다.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // API 응답을 프레임에 담아 쓰는 화면은 없다. OAuth 리다이렉트 문서도 포함해 막는다.
    res.setHeader('X-Frame-Options', 'DENY');
    // 카카오·기상청 등 외부로 나가는 요청에 우리 경로(토큰이 실릴 수 있는 URL)를 흘리지 않는다.
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  };
}
