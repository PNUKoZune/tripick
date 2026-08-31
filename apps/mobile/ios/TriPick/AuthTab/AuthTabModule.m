#import <React/RCTBridgeModule.h>

// Swift 로 쓴 TripickAuthTab 을 브리지에 등록한다.
// 인자 이름·순서는 Swift 쪽 `open(_:toolbarColor:resolver:rejecter:)` 와 정확히 맞아야 한다.
@interface RCT_EXTERN_MODULE (TripickAuthTab, NSObject)

RCT_EXTERN_METHOD(open:(NSString *)url
                  toolbarColor:(NSString *)toolbarColor
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// 인증 세션이 UI 를 띄우므로 메인 큐에서 초기화한다.
+ (BOOL)requiresMainQueueSetup
{
  return YES;
}

@end
