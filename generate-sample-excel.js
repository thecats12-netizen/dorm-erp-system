#!/usr/bin/env node

/**
 * 군대관리 모듈 샘플 엑셀 파일 생성 스크립트
 * 사용법: node generate-sample-excel.js
 * 결과: public 폴더에 두 개의 엑셀 파일 생성
 */

const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

// 출력 디렉토리
const outputDir = path.join(__dirname, 'public');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// ===== 1. 인사 샘플 데이터 =====
const personnelData = [
  {
    이름: '김준영',
    생년월일: '1995-03-15',
    연락처: '010-1111-1111',
    부서: 'F-P&C',
    재직상태: '재직',
    병역구분: '예비군',
    계산모드: 'auto',
    현재구분: '(자동계산)',
    예비군연차: '(자동계산)',
    민방위연차: '(자동계산)',
    동원여부: '동원',
    입대일: '2020-03-01',
    전역일: '2024-03-01',
    비고: '동원지정 1~4년차 테스트',
  },
  {
    이름: '이영숙',
    생년월일: '1996-06-20',
    연락처: '010-2222-2222',
    부서: 'D-CVD',
    재직상태: '재직',
    병역구분: '예비군',
    계산모드: 'auto',
    현재구분: '(자동계산)',
    예비군연차: '(자동계산)',
    민방위연차: '(자동계산)',
    동원여부: '동원미지정',
    입대일: '2021-05-15',
    전역일: '2025-05-15',
    비고: '동원미지정 1~4년차 테스트',
  },
  {
    이름: '박성철',
    생년월일: '1988-11-08',
    연락처: '010-3333-3333',
    부서: 'F-CMP',
    재직상태: '재직',
    병역구분: '예비군',
    계산모드: 'auto',
    현재구분: '(자동계산)',
    예비군연차: '(자동계산)',
    민방위연차: '(자동계산)',
    동원여부: '동원미지정',
    입대일: '2019-08-10',
    전역일: '2021-08-10',
    비고: '5~6년차 테스트 (기본훈련+작계훈련 2건)',
  },
  {
    이름: '이준호',
    생년월일: '1975-04-25',
    연락처: '010-4444-4444',
    부서: '지원',
    재직상태: '재직',
    병역구분: '민방위',
    계산모드: 'manual',
    현재구분: '민방위',
    예비군연차: 'N/A',
    민방위연차: '(자동계산)',
    동원여부: '동원미지정',
    입대일: '',
    전역일: '2010-06-30',
    비고: '민방위 교육 대상 테스트',
  },
  {
    이름: '최미영',
    생년월일: '2000-09-10',
    연락처: '010-5555-5555',
    부서: 'D-IMP',
    재직상태: '신규입사',
    병역구분: '대상아님',
    계산모드: 'auto',
    현재구분: '(자동계산)',
    예비군연차: 'N/A',
    민방위연차: 'N/A',
    동원여부: '동원미지정',
    입대일: '',
    전역일: '',
    비고: '아직 복무하지 않음 (자동생성 대상 아님)',
  },
];

// ===== 2. 훈련기록 샘플 데이터 =====
const trainingData = [
  {
    대상자: '김준영',
    훈련유형: '동원훈련',
    차수: '1차',
    훈련예정일: '2026-06-01',
    이수일: '2026-06-15',
    이수시간: 28,
    훈련상태: '완료',
    장소: '평택군부대',
    비고: '수료증 발급됨',
  },
  {
    대상자: '이영숙',
    훈련유형: '동미참훈련',
    차수: '1차',
    훈련예정일: '2026-07-01',
    이수일: '2026-07-20',
    이수시간: 32,
    훈련상태: '완료',
    장소: '용인교육장',
    비고: '수료증 발급됨',
  },
  {
    대상자: '박성철',
    훈련유형: '기본훈련',
    차수: '1차',
    훈련예정일: '2026-05-15',
    이수일: '2026-05-25',
    이수시간: 8,
    훈련상태: '완료',
    장소: '평택교육장',
    비고: '5년차',
  },
  {
    대상자: '박성철',
    훈련유형: '작계훈련',
    차수: '1차',
    훈련예정일: '2026-08-01',
    이수일: '2026-08-10',
    이수시간: 6,
    훈련상태: '완료',
    장소: '평택교육장',
    비고: '5년차',
  },
  {
    대상자: '이준호',
    훈련유형: '민방위교육',
    차수: '1차',
    훈련예정일: '2026-04-10',
    이수일: '2026-04-15',
    이수시간: 4,
    훈련상태: '완료',
    장소: '서울민방위교육장',
    비고: '민방위 연간 교육',
  },
];

// ===== 3. 엑셀 파일 생성 함수 =====
function createExcelFile(filename, sheetName, data) {
  try {
    const ws = XLSX.utils.json_to_sheet(data);
    
    // 컬럼 너비 자동 설정
    const colWidths = [];
    if (data.length > 0) {
      Object.keys(data[0]).forEach((key) => {
        const maxLen = Math.max(
          key.length,
          Math.max(...data.map((row) => String(row[key] || '').length))
        );
        colWidths.push({ wch: maxLen + 2 });
      });
    }
    ws['!cols'] = colWidths;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    
    const filePath = path.join(outputDir, filename);
    XLSX.writeFile(wb, filePath);
    console.log(`✓ 생성됨: ${filePath}`);
    return filePath;
  } catch (err) {
    console.error(`✗ 실패: ${filename}`, err.message);
  }
}

// ===== 4. 메인 실행 =====
console.log('\n📋 군대관리 샘플 엑셀 파일 생성 중...\n');

try {
  createExcelFile('군대관리_인사_샘플.xlsx', '인사정보', personnelData);
  createExcelFile('군대관리_훈련기록_샘플.xlsx', '훈련기록', trainingData);
  
  console.log('\n✅ 완료! 다음 파일이 생성되었습니다:');
  console.log(`   📁 ${outputDir}/군대관리_인사_샘플.xlsx`);
  console.log(`   📁 ${outputDir}/군대관리_훈련기록_샘플.xlsx`);
  console.log('\n💡 팁: 다운로드 후 App.tsx의 업로드 기능에서 사용하세요.');
  console.log('📖 자세한 가이드는 SAMPLE_MILITARY_UPLOAD_GUIDE.md를 참고하세요.\n');
} catch (err) {
  console.error('❌ 오류 발생:', err);
  process.exit(1);
}
