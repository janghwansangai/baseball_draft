# 야구 선수 드래프트 앱 2026

이 프로젝트는 Vite + React 기반으로 작성된 초등학교 야구 신인 드래프트 입찰 시스템입니다. Firebase 실시간 데이터베이스(Firestore)를 사용하여 여러 모둠이 동시에 입찰하고 결과를 확인할 수 있습니다.

## 시작하기 전에 (Firebase 설정)

이 앱은 Firebase Firestore와 Authentication(익명 로그인 또는 커스텀 토큰)을 사용합니다.
로컬이나 서버(Vercel, Netlify 등)에서 실행하려면 Firebase 설정이 필요합니다.

1. `.env.example` 파일을 복사하여 `.env` 파일을 생성하세요.
2. Firebase Console에서 프로젝트 설정으로 들어가 앱 설정 정보(API 키 등)를 확인하고 `.env` 파일에 기입하세요.

## 로컬 개발 방법

> Node.js와 npm이 설치되어 있어야 합니다.

```bash
# 의존성 설치
npm install

# 개발 서버 실행
npm run dev
```

브라우저에서 `http://localhost:5173` 으로 접속하여 앱을 확인할 수 있습니다.

## 깃허브 배포 (Vercel 연동 추천)

1. 이 저장소를 자신의 깃허브 계정에 커밋/푸시합니다.
2. [Vercel](https://vercel.com)과 같은 서비스에 로그인하여 새 프로젝트를 만들고 이 깃허브 저장소를 연결합니다.
3. 배포(Deploy) 환경 변수(Environment Variables) 설정 단계에서 `.env` 파일에 적었던 `VITE_FIREBASE_...` 변수들을 그대로 추가해 줍니다.
4. 배포 버튼을 누르면 성공적으로 서비스가 배포됩니다!

## 선생님(관리자) 접속 방법
메인 화면의 하단 "선생님(관리자) 입장"을 누르고, 비밀번호 **jfl2025** 를 입력하여 입장합니다. (소스코드 내에 하드코딩 되어있으므로, 필요시 `App.jsx`에서 수정하세요.)
