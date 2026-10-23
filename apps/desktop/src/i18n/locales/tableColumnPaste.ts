export const tableColumnPasteEn = {
  title: "Paste fields",
  description: "Paste MySQL column definitions separated by commas. Review them before adding to the draft; changes are applied when you save the table.",
  input: "Column definitions",
  preview: "Ready to add {count} fields",
  import: "Add {count} fields",
  position: "Line {line}, column {column}",
  syntax: "Incomplete or invalid column definition. Check separators, quotes, parentheses and repeated attributes.",
  unsupported: "Unsupported definition. Use column names, types, NULL / NOT NULL, DEFAULT, COMMENT and ON UPDATE CURRENT_TIMESTAMP only. Full SQL statements and constraints are not supported.",
  ambiguous: "Ambiguous quoting or escaping. Use backticks for identifiers and single quotes with doubled apostrophes for strings; backslash escapes are not supported.",
  duplicate: "This field name already exists in the table or pasted text, including fields marked for deletion. Rename or remove it before importing.",
  tooLarge: "Paste at most 65,536 characters at a time.",
  precision: "CURRENT_TIMESTAMP precision must match the DATETIME / TIMESTAMP column precision (0–6).",
};

export const tableColumnPasteZhCN = {
  title: "粘贴字段",
  description: "粘贴以逗号分隔的 MySQL 字段定义。确认解析结果后加入草稿，保存表结构时才会应用变更。",
  input: "字段定义",
  preview: "可添加 {count} 个字段",
  import: "添加 {count} 个字段",
  position: "第 {line} 行，第 {column} 列",
  syntax: "字段定义不完整或格式错误，请检查分隔符、引号、括号及重复属性。",
  unsupported: "不支持此定义。目前支持字段名、类型、NULL / NOT NULL、DEFAULT、COMMENT 和 ON UPDATE CURRENT_TIMESTAMP，不支持完整 SQL 语句及约束。",
  ambiguous: "引号或转义存在歧义。字段名请使用反引号，字符串请使用单引号并将内部单引号写成两个单引号；暂不支持反斜杠转义。",
  duplicate: "字段名与表中字段或本次粘贴内容重复，包含已标记删除的字段。请修改名称或移除此定义后再导入。",
  tooLarge: "单次粘贴不能超过 65,536 个字符。",
  precision: "CURRENT_TIMESTAMP 精度必须与 DATETIME / TIMESTAMP 字段精度一致（0–6）。",
} satisfies typeof tableColumnPasteEn;

export const tableColumnPasteZhTW = {
  title: "貼上欄位",
  description: "貼上以逗號分隔的 MySQL 欄位定義。確認解析結果後加入草稿，儲存資料表結構時才會套用變更。",
  input: "欄位定義",
  preview: "可新增 {count} 個欄位",
  import: "新增 {count} 個欄位",
  position: "第 {line} 行，第 {column} 欄",
  syntax: "欄位定義不完整或格式錯誤，請檢查分隔符號、引號、括號及重複屬性。",
  unsupported: "不支援此定義。目前支援欄位名稱、型別、NULL / NOT NULL、DEFAULT、COMMENT 和 ON UPDATE CURRENT_TIMESTAMP，不支援完整 SQL 陳述式及約束。",
  ambiguous: "引號或跳脫字元存在歧義。欄位名稱請使用反引號，字串請使用單引號並將內部單引號寫成兩個單引號；暫不支援反斜線跳脫。",
  duplicate: "欄位名稱與資料表或本次貼上內容重複，包含已標記刪除的欄位。請修改名稱或移除此定義後再匯入。",
  tooLarge: "單次貼上不能超過 65,536 個字元。",
  precision: "CURRENT_TIMESTAMP 精度必須與 DATETIME / TIMESTAMP 欄位精度一致（0–6）。",
} satisfies typeof tableColumnPasteEn;

export const tableColumnPasteJa = {
  title: "フィールドを貼り付け",
  description: "カンマ区切りの MySQL 列定義を貼り付けます。解析結果を確認して下書きに追加し、テーブル保存時に変更を適用します。",
  input: "列定義",
  preview: "{count} 個のフィールドを追加できます",
  import: "{count} 個のフィールドを追加",
  position: "{line} 行、{column} 列",
  syntax: "列定義が不完全か無効です。区切り、引用符、括弧、属性の重複を確認してください。",
  unsupported: "列名、型、NULL / NOT NULL、DEFAULT、COMMENT、ON UPDATE CURRENT_TIMESTAMP のみ対応しています。完全な SQL 文や制約には対応していません。",
  ambiguous: "引用符またはエスケープが曖昧です。識別子にはバッククォート、文字列には単一引用符を使い、内部の単一引用符は二重にしてください。バックスラッシュエスケープには対応していません。",
  duplicate: "テーブルまたは貼り付け内容に同名フィールドがあります。削除予定のフィールドも含まれます。名前を変更するか定義を削除してください。",
  tooLarge: "一度に貼り付けられるのは 65,536 文字までです。",
  precision: "CURRENT_TIMESTAMP の精度は DATETIME / TIMESTAMP 列の精度（0–6）と一致する必要があります。",
} satisfies typeof tableColumnPasteEn;

export const tableColumnPasteKo = {
  title: "필드 붙여넣기",
  description: "쉼표로 구분된 MySQL 열 정의를 붙여넣으세요. 분석 결과를 확인하여 초안에 추가하며, 테이블을 저장할 때 변경 사항이 적용됩니다.",
  input: "열 정의",
  preview: "필드 {count}개를 추가할 수 있습니다",
  import: "필드 {count}개 추가",
  position: "{line}행, {column}열",
  syntax: "열 정의가 불완전하거나 잘못되었습니다. 구분 기호, 따옴표, 괄호 및 중복 속성을 확인하세요.",
  unsupported: "열 이름, 유형, NULL / NOT NULL, DEFAULT, COMMENT 및 ON UPDATE CURRENT_TIMESTAMP만 지원합니다. 전체 SQL 문과 제약 조건은 지원하지 않습니다.",
  ambiguous: "따옴표 또는 이스케이프가 모호합니다. 식별자에는 백틱을, 문자열에는 작은따옴표를 사용하고 내부 작은따옴표는 두 번 입력하세요. 백슬래시 이스케이프는 지원하지 않습니다.",
  duplicate: "테이블 또는 붙여넣은 내용에 같은 필드 이름이 있습니다. 삭제 표시된 필드도 포함됩니다. 이름을 변경하거나 정의를 제거하세요.",
  tooLarge: "한 번에 최대 65,536자까지 붙여넣을 수 있습니다.",
  precision: "CURRENT_TIMESTAMP 정밀도는 DATETIME / TIMESTAMP 열 정밀도(0–6)와 일치해야 합니다.",
} satisfies typeof tableColumnPasteEn;

export const tableColumnPasteEs = {
  title: "Pegar campos",
  description: "Pegue definiciones de columnas MySQL separadas por comas. Revise el resultado antes de añadirlo al borrador; los cambios se aplican al guardar la tabla.",
  input: "Definiciones de columnas",
  preview: "Se pueden añadir {count} campos",
  import: "Añadir {count} campos",
  position: "Línea {line}, columna {column}",
  syntax: "Definición incompleta o inválida. Revise separadores, comillas, paréntesis y atributos repetidos.",
  unsupported: "Solo se admiten nombres, tipos, NULL / NOT NULL, DEFAULT, COMMENT y ON UPDATE CURRENT_TIMESTAMP. No se admiten sentencias SQL completas ni restricciones.",
  ambiguous: "Comillas o escapes ambiguos. Use acentos graves para identificadores y comillas simples para cadenas, duplicando los apóstrofos internos. No se admiten escapes con barra inversa.",
  duplicate: "El nombre ya existe en la tabla o el texto pegado, incluidos los campos marcados para borrar. Cambie el nombre o elimine la definición.",
  tooLarge: "Pegue como máximo 65.536 caracteres cada vez.",
  precision: "La precisión de CURRENT_TIMESTAMP debe coincidir con la de la columna DATETIME / TIMESTAMP (0–6).",
} satisfies typeof tableColumnPasteEn;

export const tableColumnPastePtBR = {
  title: "Colar campos",
  description: "Cole definições de colunas MySQL separadas por vírgulas. Revise o resultado antes de adicionar ao rascunho; as alterações são aplicadas ao salvar a tabela.",
  input: "Definições de colunas",
  preview: "Pronto para adicionar {count} campos",
  import: "Adicionar {count} campos",
  position: "Linha {line}, coluna {column}",
  syntax: "Definição incompleta ou inválida. Verifique separadores, aspas, parênteses e atributos repetidos.",
  unsupported: "Apenas nomes, tipos, NULL / NOT NULL, DEFAULT, COMMENT e ON UPDATE CURRENT_TIMESTAMP são aceitos. Instruções SQL completas e restrições não são aceitas.",
  ambiguous: "Aspas ou escapes ambíguos. Use crases para identificadores e aspas simples para textos, duplicando as aspas internas. Escapes com barra invertida não são aceitos.",
  duplicate: "O nome já existe na tabela ou no texto colado, incluindo campos marcados para exclusão. Renomeie ou remova a definição.",
  tooLarge: "Cole no máximo 65.536 caracteres por vez.",
  precision: "A precisão de CURRENT_TIMESTAMP deve corresponder à da coluna DATETIME / TIMESTAMP (0–6).",
} satisfies typeof tableColumnPasteEn;

export const tableColumnPasteIt = {
  title: "Incolla campi",
  description: "Incolla definizioni di colonne MySQL separate da virgole. Controlla il risultato prima di aggiungerlo alla bozza; le modifiche vengono applicate salvando la tabella.",
  input: "Definizioni delle colonne",
  preview: "Pronto ad aggiungere {count} campi",
  import: "Aggiungi {count} campi",
  position: "Riga {line}, colonna {column}",
  syntax: "Definizione incompleta o non valida. Controlla separatori, virgolette, parentesi e attributi ripetuti.",
  unsupported: "Sono supportati solo nomi, tipi, NULL / NOT NULL, DEFAULT, COMMENT e ON UPDATE CURRENT_TIMESTAMP. Istruzioni SQL complete e vincoli non sono supportati.",
  ambiguous: "Virgolette o escape ambigui. Usa apici inversi per gli identificatori e apici singoli per le stringhe, raddoppiando quelli interni. Gli escape con barra inversa non sono supportati.",
  duplicate: "Il nome esiste già nella tabella o nel testo incollato, inclusi i campi segnati per l’eliminazione. Rinomina o rimuovi la definizione.",
  tooLarge: "Incolla al massimo 65.536 caratteri alla volta.",
  precision: "La precisione di CURRENT_TIMESTAMP deve corrispondere a quella della colonna DATETIME / TIMESTAMP (0–6).",
} satisfies typeof tableColumnPasteEn;

export const tableColumnPasteRu = {
  title: "Вставить поля",
  description: "Вставьте определения столбцов MySQL через запятую. Проверьте результат перед добавлением в черновик; изменения применяются при сохранении таблицы.",
  input: "Определения столбцов",
  preview: "Можно добавить полей: {count}",
  import: "Добавить поля: {count}",
  position: "Строка {line}, столбец {column}",
  syntax: "Неполное или неверное определение. Проверьте разделители, кавычки, скобки и повторяющиеся атрибуты.",
  unsupported: "Поддерживаются только имена, типы, NULL / NOT NULL, DEFAULT, COMMENT и ON UPDATE CURRENT_TIMESTAMP. Полные SQL-запросы и ограничения не поддерживаются.",
  ambiguous: "Неоднозначные кавычки или экранирование. Используйте обратные кавычки для имён и одинарные для строк, удваивая внутренние апострофы. Экранирование обратной косой чертой не поддерживается.",
  duplicate: "Имя уже есть в таблице или вставленном тексте, включая поля, отмеченные для удаления. Переименуйте поле или удалите определение.",
  tooLarge: "Можно вставить не более 65 536 символов за раз.",
  precision: "Точность CURRENT_TIMESTAMP должна совпадать с точностью столбца DATETIME / TIMESTAMP (0–6).",
} satisfies typeof tableColumnPasteEn;

export const tableColumnPastePl = {
  title: "Wklej pola",
  description: "Wklej definicje kolumn MySQL rozdzielone przecinkami. Sprawdź wynik przed dodaniem do szkicu; zmiany zostaną zastosowane przy zapisie tabeli.",
  input: "Definicje kolumn",
  preview: "Liczba pól do dodania: {count}",
  import: "Dodaj pola: {count}",
  position: "Wiersz {line}, kolumna {column}",
  syntax: "Niepełna lub nieprawidłowa definicja. Sprawdź separatory, cudzysłowy, nawiasy i powtórzone atrybuty.",
  unsupported: "Obsługiwane są tylko nazwy, typy, NULL / NOT NULL, DEFAULT, COMMENT i ON UPDATE CURRENT_TIMESTAMP. Pełne instrukcje SQL i ograniczenia nie są obsługiwane.",
  ambiguous: "Niejednoznaczne cudzysłowy lub znaki ucieczki. Użyj odwrotnych apostrofów dla nazw i apostrofów dla tekstu, podwajając apostrofy wewnątrz. Sekwencje z ukośnikiem odwrotnym nie są obsługiwane.",
  duplicate: "Nazwa już istnieje w tabeli lub wklejonym tekście, także w polach oznaczonych do usunięcia. Zmień nazwę lub usuń definicję.",
  tooLarge: "Można wkleić najwyżej 65 536 znaków naraz.",
  precision: "Precyzja CURRENT_TIMESTAMP musi odpowiadać precyzji kolumny DATETIME / TIMESTAMP (0–6).",
} satisfies typeof tableColumnPasteEn;

export const tableColumnPasteTr = {
  title: "Alanları yapıştır",
  description: "Virgülle ayrılmış MySQL sütun tanımlarını yapıştırın. Taslağa eklemeden önce sonucu inceleyin; değişiklikler tablo kaydedildiğinde uygulanır.",
  input: "Sütun tanımları",
  preview: "{count} alan eklenebilir",
  import: "{count} alan ekle",
  position: "Satır {line}, sütun {column}",
  syntax: "Eksik veya geçersiz sütun tanımı. Ayırıcıları, tırnakları, parantezleri ve tekrarlanan öznitelikleri kontrol edin.",
  unsupported: "Yalnızca ad, tür, NULL / NOT NULL, DEFAULT, COMMENT ve ON UPDATE CURRENT_TIMESTAMP desteklenir. Tam SQL ifadeleri ve kısıtlamalar desteklenmez.",
  ambiguous: "Belirsiz tırnak veya kaçış. Adlar için ters tırnak, metinler için tek tırnak kullanın ve içteki tek tırnakları çift yazın. Ters eğik çizgi kaçışları desteklenmez.",
  duplicate: "Bu ad tabloda veya yapıştırılan metinde zaten var; silinmek üzere işaretlenen alanlar da dahildir. Adı değiştirin veya tanımı kaldırın.",
  tooLarge: "Bir seferde en fazla 65.536 karakter yapıştırın.",
  precision: "CURRENT_TIMESTAMP hassasiyeti DATETIME / TIMESTAMP sütun hassasiyetiyle (0–6) eşleşmelidir.",
} satisfies typeof tableColumnPasteEn;

export const tableColumnPasteAz = {
  title: "Sahələri yapışdır",
  description: "Vergüllə ayrılmış MySQL sütun təriflərini yapışdırın. Qaralamaya əlavə etməzdən əvvəl nəticəni yoxlayın; dəyişikliklər cədvəl saxlanıldıqda tətbiq olunur.",
  input: "Sütun tərifləri",
  preview: "{count} sahə əlavə edilə bilər",
  import: "{count} sahə əlavə et",
  position: "Sətir {line}, sütun {column}",
  syntax: "Natamam və ya yanlış sütun tərifi. Ayırıcıları, dırnaqları, mötərizələri və təkrarlanan atributları yoxlayın.",
  unsupported: "Yalnız adlar, tiplər, NULL / NOT NULL, DEFAULT, COMMENT və ON UPDATE CURRENT_TIMESTAMP dəstəklənir. Tam SQL əmrləri və məhdudiyyətlər dəstəklənmir.",
  ambiguous: "Dırnaq və ya qaçış qeyri-müəyyəndir. Adlar üçün tərs dırnaq, mətnlər üçün tək dırnaq istifadə edin və daxili tək dırnaqları iki dəfə yazın. Tərs çəp xəttlə qaçış dəstəklənmir.",
  duplicate: "Ad cədvəldə və ya yapışdırılan mətndə artıq mövcuddur, silinmək üçün işarələnmiş sahələr də daxildir. Adı dəyişin və ya tərifi silin.",
  tooLarge: "Bir dəfəyə ən çox 65 536 simvol yapışdırın.",
  precision: "CURRENT_TIMESTAMP dəqiqliyi DATETIME / TIMESTAMP sütununun dəqiqliyinə (0–6) uyğun olmalıdır.",
} satisfies typeof tableColumnPasteEn;

export const tableColumnPasteId = {
  title: "Tempel bidang",
  description: "Tempel definisi kolom MySQL yang dipisahkan koma. Tinjau hasil sebelum menambahkannya ke draf; perubahan diterapkan saat tabel disimpan.",
  input: "Definisi kolom",
  preview: "Siap menambahkan {count} bidang",
  import: "Tambahkan {count} bidang",
  position: "Baris {line}, kolom {column}",
  syntax: "Definisi kolom tidak lengkap atau tidak valid. Periksa pemisah, tanda kutip, tanda kurung, dan atribut berulang.",
  unsupported: "Hanya nama, tipe, NULL / NOT NULL, DEFAULT, COMMENT, dan ON UPDATE CURRENT_TIMESTAMP yang didukung. Pernyataan SQL lengkap dan batasan tidak didukung.",
  ambiguous: "Tanda kutip atau escape ambigu. Gunakan backtick untuk nama dan kutip tunggal untuk teks, dengan menggandakan kutip tunggal di dalamnya. Escape garis miring terbalik tidak didukung.",
  duplicate: "Nama sudah ada di tabel atau teks yang ditempel, termasuk bidang yang ditandai untuk dihapus. Ubah nama atau hapus definisi.",
  tooLarge: "Tempel maksimal 65.536 karakter sekaligus.",
  precision: "Presisi CURRENT_TIMESTAMP harus sesuai dengan presisi kolom DATETIME / TIMESTAMP (0–6).",
} satisfies typeof tableColumnPasteEn;

export const tableColumnPasteTh = {
  title: "วางฟิลด์",
  description: "วางคำจำกัดความคอลัมน์ MySQL ที่คั่นด้วยจุลภาค ตรวจสอบผลก่อนเพิ่มลงในฉบับร่าง การเปลี่ยนแปลงจะมีผลเมื่อบันทึกตาราง",
  input: "คำจำกัดความคอลัมน์",
  preview: "พร้อมเพิ่ม {count} ฟิลด์",
  import: "เพิ่ม {count} ฟิลด์",
  position: "บรรทัด {line} คอลัมน์ {column}",
  syntax: "คำจำกัดความคอลัมน์ไม่สมบูรณ์หรือไม่ถูกต้อง โปรดตรวจสอบตัวคั่น เครื่องหมายอัญประกาศ วงเล็บ และแอตทริบิวต์ที่ซ้ำกัน",
  unsupported: "รองรับเฉพาะชื่อ ชนิด NULL / NOT NULL, DEFAULT, COMMENT และ ON UPDATE CURRENT_TIMESTAMP ไม่รองรับคำสั่ง SQL แบบเต็มหรือข้อจำกัด",
  ambiguous: "เครื่องหมายอัญประกาศหรือการหลีกอักขระกำกวม ใช้แบ็กทิกสำหรับชื่อและอัญประกาศเดี่ยวสำหรับข้อความ โดยเขียนอัญประกาศเดี่ยวภายในซ้ำสองครั้ง ไม่รองรับการหลีกด้วยแบ็กสแลช",
  duplicate: "ชื่อนี้มีอยู่แล้วในตารางหรือข้อความที่วาง รวมถึงฟิลด์ที่ทำเครื่องหมายเพื่อลบ โปรดเปลี่ยนชื่อหรือลบคำจำกัดความ",
  tooLarge: "วางได้สูงสุดครั้งละ 65,536 อักขระ",
  precision: "ความละเอียดของ CURRENT_TIMESTAMP ต้องตรงกับคอลัมน์ DATETIME / TIMESTAMP (0–6)",
} satisfies typeof tableColumnPasteEn;
