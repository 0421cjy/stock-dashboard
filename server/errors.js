// 서버 전체에서 쓰는 오류. message는 화면에 그대로 보여줄 한국어 문장이다.
export class AppError extends Error {
  constructor(code, message, status = 500) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
  }
}
