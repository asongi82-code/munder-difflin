# 칼테라 오피스 캐릭터 스프라이트

- 프레임 크기: 32 x 48 px (오피스용)
- `<이름>_sheet.png`: 가로 4칸 x 세로 8줄 시트 (줄 순서는 sheet_layout.json)
  0 front / 1 back / 2 side_right / 3 side_left
  4 front_walk / 5 back_walk / 6 side_walk_right / 7 side_walk_left (각 4프레임)
- `frames/`: 같은 그림을 한 장씩 나눈 파일
- `<이름>_large.png`: 원본을 정리한 큰 도트(약 58x114) - 프로필 카드·팝업용

화면에 띄울 때
- CSS: image-rendering: pixelated;
- Canvas: ctx.imageSmoothingEnabled = false;
- 크기는 1배, 2배, 3배처럼 정수배로만 (예: 32x48 → 64x96)
- 걷기 애니메이션은 초당 6프레임 정도 권장
