import { describe, expect, it } from 'vitest';
import { customerLabelWithoutCourierContact, extractTrailingCustomerCodeFromDisplayName } from '../customers/customerIdentity';
import { extractCustomerHintFromExportFileName } from '../whatsappExportCustomerHint';
import { extractCustomerIdentityEvidence, resolveCanonicalCustomerIdentity } from '../customers/canonicalCustomerIdentityResolver';

const label = 'مدام عميلة 321..رقم للمندوب 01501234567';
describe('explicit courier annotation in customer labels', () => {
  it('retains the separate code and excludes only a clearly labelled valid courier phone', () => {
    expect(customerLabelWithoutCourierContact(label)).toBe('مدام عميلة 321');
    expect(extractTrailingCustomerCodeFromDisplayName(label)).toBe('321');
    expect(extractCustomerHintFromExportFileName(label+'.zip').codeHint).toBe('321');
  });
  it.each(['عميلة 01501234567', 'عميلة 321 رقم العميل 01501234567', 'عميلة 321..رقم للمندوب 1234', 'عميلة رقم للمندوب 01501234567'])(
    'does not strip an ordinary, invalid or unlabelled phone: %s', value => {
      expect(customerLabelWithoutCourierContact(value)).toBe(value);
    });
  it('uses the existing unique-code owner, not a name match or the courier customer record', () => {
    const session: any = { customerName: label, messages: [{ direction: 'inbound', sender: label, text: 'سلام عليكم' }] };
    const evidence = extractCustomerIdentityEvidence(session, label+'.zip');
    expect(evidence.customerCodes).toEqual(['321']);
    expect(evidence.contactPhones).toEqual([]);
    const id = '11111111-1111-4111-8111-111111111111';
    const other = '22222222-2222-4222-8222-222222222222';
    const byId = new Map([
      [id, {id,customerCode:'321',phones:['01001234567'],name:'مدام عميلة',branch:null,isDuplicate:false}],
      [other, {id:other,customerCode:'999',phones:['01501234567'],name:'مندوب',branch:null,isDuplicate:false}],
    ]);
    expect(resolveCanonicalCustomerIdentity(evidence,{byId,aliasToCanonical:new Map()})).toMatchObject({status:'resolved',customerId:id,resolvedBy:'customer_code'});
    byId.set(other,{...byId.get(other)!,customerCode:'321'});
    expect(resolveCanonicalCustomerIdentity(evidence,{byId,aliasToCanonical:new Map()}).status).toBe('ambiguous');
  });
});
