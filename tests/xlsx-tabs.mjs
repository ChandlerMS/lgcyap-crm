import { strFromU8, unzipSync } from 'fflate';

// Test helper (not a test file): reads the tabs out of a generated .xlsx or a multipart Drive upload carrying one.
const decode = text => text.replace(/&(lt|gt|quot|apos|amp);/g, (_, name) => ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' })[name]);
/** Every tab's rows from an .xlsx, or from a multipart Drive upload that carries one. */
export function workbookTabs(body) {
  let bytes = Buffer.from(body);
  const zip = bytes.indexOf(Buffer.from('PK\u0003\u0004'));
  if (zip > 0) bytes = bytes.subarray(zip, bytes.lastIndexOf(Buffer.from('\r\n--')));
  const files = unzipSync(new Uint8Array(bytes));
  const names = [...strFromU8(files['xl/workbook.xml']).matchAll(/<sheet name="([^"]*)"/g)].map(match => decode(match[1]));
  return names.map((name, i) => ({ name, rows: [...strFromU8(files[`xl/worksheets/sheet${i + 1}.xml`]).matchAll(/<row [^>]*>(.*?)<\/row>/g)].map(row => [...row[1].matchAll(/<t xml:space="preserve">([^<]*)<\/t>/g)].map(cell => decode(cell[1]))) }));
}
