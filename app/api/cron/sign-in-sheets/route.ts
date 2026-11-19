export const dynamic = 'force-dynamic';
const retired = () => Response.json({ error: 'Monthly sign-in Sheets have been retired. Use Export to Google Sheets on the Signed In list.' }, { status: 410 });
export const GET = retired;
export const POST = retired;
