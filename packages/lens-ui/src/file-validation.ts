const MAX_FILE_SIZE = 200 * 1024 * 1024;

export async function readValidatedHwpx(file: File): Promise<Uint8Array> {
  if (!file.name.toLocaleLowerCase("en-US").endsWith(".hwpx")) {
    throw new Error("M0에서는 .hwpx 파일만 열 수 있습니다.");
  }
  if (file.size === 0) {
    throw new Error("빈 파일은 열 수 없습니다.");
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new Error("200MB보다 큰 파일은 M0에서 지원하지 않습니다.");
  }

  const bytes = new Uint8Array(await readFileBuffer(file));
  if (!hasZipSignature(bytes)) {
    throw new Error("HWPX 컨테이너의 ZIP 시그니처를 확인할 수 없습니다.");
  }
  return bytes;
}

function readFileBuffer(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === "function") {
    return file.arrayBuffer();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error("파일을 읽지 못했습니다."));
    reader.readAsArrayBuffer(file);
  });
}

function hasZipSignature(bytes: Uint8Array): boolean {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    return false;
  }
  return (
    (bytes[2] === 0x03 && bytes[3] === 0x04) ||
    (bytes[2] === 0x05 && bytes[3] === 0x06) ||
    (bytes[2] === 0x07 && bytes[3] === 0x08)
  );
}
