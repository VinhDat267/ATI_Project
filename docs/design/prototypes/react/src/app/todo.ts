// Đánh dấu hành vi của bản mẫu chưa chuyển sang React. Bản hoàn chỉnh không còn lời gọi nào tới hàm này.
export function todo(what: string): never {
  throw new Error(`Chưa chuyển sang React: ${what}`);
}
