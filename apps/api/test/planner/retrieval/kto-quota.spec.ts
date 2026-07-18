/// <reference types="jest" />

import {
  detectKtoQuota,
  KtoCallBudget,
  KtoQuotaExceededError,
} from '../../../src/planner/retrieval/tour-api.service';

describe('detectKtoQuota', () => {
  it('서비스 JSON header.resultCode=22 를 초과로 본다', () => {
    expect(detectKtoQuota({ response: { header: { resultCode: '22', resultMsg: 'LIMITED...' } } })).toBe(true);
  });

  it('resultMsg 의 LIMITED_NUMBER... 문구를 초과로 본다', () => {
    expect(
      detectKtoQuota({
        response: { header: { resultCode: '99', resultMsg: 'LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR' } },
      }),
    ).toBe(true);
  });

  it('게이트웨이 XML 문자열(returnReasonCode 22)을 초과로 본다', () => {
    const xml =
      '<OpenAPI_ServiceResponse><cmmMsgHeader>' +
      '<returnAuthMsg>LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR</returnAuthMsg>' +
      '<returnReasonCode>22</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>';
    expect(detectKtoQuota(xml)).toBe(true);
  });

  it('정상 응답(resultCode=0000)은 초과가 아니다', () => {
    expect(detectKtoQuota({ response: { header: { resultCode: '0000', resultMsg: 'OK' }, body: {} } })).toBe(false);
  });

  it('header 없는·빈 값은 초과가 아니다', () => {
    expect(detectKtoQuota({})).toBe(false);
    expect(detectKtoQuota(null)).toBe(false);
    expect(detectKtoQuota('정상 텍스트')).toBe(false);
  });
});

describe('KtoCallBudget', () => {
  it('한도만큼 consume 을 허용하고 그 뒤엔 막는다', () => {
    const budget = new KtoCallBudget(3);
    expect(budget.consume()).toBe(true);
    expect(budget.consume()).toBe(true);
    expect(budget.consume()).toBe(true);
    expect(budget.isExhausted).toBe(true);
    expect(budget.consume()).toBe(false);
  });

  it('markExhausted 는 남은 예산과 무관하게 즉시 소진 처리한다', () => {
    const budget = new KtoCallBudget(100);
    expect(budget.isExhausted).toBe(false);
    budget.markExhausted();
    expect(budget.isExhausted).toBe(true);
    expect(budget.consume()).toBe(false);
  });

  it('한도 0·음수는 처음부터 소진 상태다', () => {
    expect(new KtoCallBudget(0).isExhausted).toBe(true);
    expect(new KtoCallBudget(-5).isExhausted).toBe(true);
  });

  it('KtoQuotaExceededError 는 이름과 경로를 담는다', () => {
    const error = new KtoQuotaExceededError('detailIntro2');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('KtoQuotaExceededError');
    expect(error.message).toContain('detailIntro2');
  });
});
