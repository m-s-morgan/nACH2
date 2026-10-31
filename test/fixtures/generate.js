// Records what nach produces for a broad set of inputs, so a dependency update can be checked
// byte for byte against the published nach@0.3.5. Run with a path to the nach to exercise:
//
//   node test/fixtures/generate.js <path to nach> > out.json
//
// The clock is frozen (file creation date / time and business-day math read it).
'use strict';

const FIXED = Date.UTC(2026, 9, 31, 15, 4, 5);
const RealDate = Date;

class FixedDate extends RealDate {
    constructor(...args) {
        super(...(args.length ? args : [FIXED]));
    }

    static now() {
        return FIXED;
    }
}

global.Date = FixedDate;

const nach = require(require('path').resolve(process.argv[2] || '.'));
const out = {};

function capture(name, fn) {
    try {
        out[name] = { ok: fn() };
    } catch (e) {
        out[name] = { error: { name: e && e.name, message: e && e.message } };
    }
}

function file(fileOptions, batches) {
    const f = new nach.File(fileOptions);

    for (const b of batches) {
        const batch = new nach.Batch(b.options);

        for (const e of b.entries) {
            batch.addEntry(new nach.Entry(e));
        }

        f.addBatch(batch);
    }

    return f;
}

function generated(f) {
    let result;

    f.generateFile((s) => { result = s; });

    return result;
}

const ORIGIN = { immediateDestination: '081000032', immediateOrigin: '123456789', immediateDestinationName: 'Some Bank', immediateOriginName: 'Your Company Inc', referenceCode: '#A000001' };
const OUR_ORIGIN = { immediateDestination: '031000053', immediateOrigin: '1234567890', immediateDestinationName: 'PNC BANK', immediateOriginName: 'PROFIT RX LLC', referenceCode: ' ' };

function batch(debit, sec, description, entries, extra) {
    return {
        options: Object.assign({
            serviceClassCode: debit ? '225' : '220',
            companyName: 'PROFIT RX LLC',
            standardEntryClassCode: sec,
            companyIdentification: '1234567890',
            companyEntryDescription: description,
            companyDescriptiveDate: '261031',
            effectiveEntryDate: new FixedDate(Date.UTC(2026, 10, 2, 12)),
            originatingDFI: '03100005'
        }, extra || {}),
        entries
    };
}

function entry(code, routing, account, amount, name, extra) {
    return Object.assign({ receivingDFI: routing, DFIAccount: account, amount, transactionCode: code, idNumber: 'ID' + amount, individualName: name, discretionaryData: 'S' }, extra || {});
}

// README-style file
capture('readme', () => generated(file(ORIGIN, [
    { options: { serviceClassCode: '220', companyName: 'Your Company Inc', standardEntryClassCode: 'WEB', companyIdentification: '123456789', companyEntryDescription: 'Trans Description', companyDescriptiveDate: '261031', effectiveEntryDate: new FixedDate(Date.UTC(2026, 10, 2, 12)), originatingDFI: '081000032' },
        entries: [entry('22', '081000210', '12345678901234567', '3521', 'Glen Selle', { idNumber: 'RAj##23920rjf31', discretionaryData: 'A1' })] }
])));

// the shapes services/ach.ts builds: PNC origin, blank reference code, credit and debit batches,
// PPD and CCD, 22/27/32/37 transaction codes, cents and large amounts, long and odd names
const many = [];

for (let i = 0; i < 37; ++i) {
    many.push(entry(i % 2 ? '22' : '32', i % 3 ? '081000210' : '031000053', String(10000000 + i * 7919), String(1 + i * 12345), `MEMBER ${i} O'NEIL-SMITH JR`));
}

capture('ours-credit-debit', () => generated(file(OUR_ORIGIN, [
    batch(false, 'PPD', 'PROFITXFER', many.slice(0, 20)),
    batch(true, 'PPD', 'PROFITDEBT', many.slice(20).map((e) => Object.assign({}, e, { transactionCode: e.transactionCode === '22' ? '27' : '37' }))),
    batch(false, 'CCD', 'PROFITXFER', [entry('22', '021000021', '9876543210', '99999999', 'A VERY LONG ORGANIZATION NAME THAT RUNS PAST TWENTY TWO CHARACTERS')])
])));

capture('single-entry', () => generated(file(OUR_ORIGIN, [batch(false, 'PPD', 'XFER', [entry('22', '081000210', '123', '1', 'A')])])));
capture('empty-file', () => generated(new nach.File(OUR_ORIGIN)));

// the pieces generated on their own, as services/ach.ts streams them
capture('pieces', () => {
    const f = file(OUR_ORIGIN, [batch(false, 'PPD', 'XFER', many.slice(0, 3))]);
    const parts = {};

    f.generateHeader((s) => { parts.header = s; });
    f._batches[0].generateString((s) => { parts.batch = s; });
    f.generateControl((s) => { parts.control = s; });
    parts.fileHeaderFields = Object.keys(f.header).map((k) => [k, f.header[k].value]);
    parts.batchControl = Object.keys(f._batches[0].control).map((k) => [k, f._batches[0].control[k].value]);
    parts.entryFields = Object.keys(f._batches[0]._entries[0].fields).map((k) => [k, f._batches[0]._entries[0].fields[k].value]);

    return parts;
});

// validation: what is refused, and how
const bad = {
    'bad-routing-checksum': () => new nach.Entry(entry('22', '081000211', '1', '1', 'X')),
    'bad-transaction-code': () => new nach.Entry(entry('99', '081000210', '1', '1', 'X')),
    'non-numeric-amount': () => new nach.Entry(entry('22', '081000210', '1', '12a', 'X')),
    'missing-required': () => new nach.Entry({ receivingDFI: '081000210' }),
    'too-long-account': () => new nach.Entry(entry('22', '081000210', '123456789012345678901', '1', 'X')),
    'bad-service-class': () => new nach.Batch(batch(false, 'PPD', 'X', []).options && Object.assign(batch(false, 'PPD', 'X', []).options, { serviceClassCode: '999' })),
    'bad-sec-code': () => new nach.Batch(Object.assign(batch(false, 'PPD', 'X', []).options, { standardEntryClassCode: 'ZZZ' })),
    'file-missing-origin': () => new nach.File({ immediateDestination: '081000032' })
};

for (const name of Object.keys(bad)) {
    capture(name, () => { bad[name](); return 'accepted'; });
}

// utils
capture('utils', () => {
    const U = nach.Utils;

    return {
        pad: [U.pad('abc', 6), U.pad('abc', 6, false), U.pad(12, 6, false, '0'), U.pad('', 94, '9').length, U.pad('toolongvalue', 4)],
        nl: JSON.stringify(U.newLineChar()),
        nextMultiple: [U.getNextMultiple(1, 10), U.getNextMultiple(10, 10), U.getNextMultiple(11, 10)],
        nextMultipleDiff: [U.getNextMultipleDiff(1, 10), U.getNextMultipleDiff(10, 10), U.getNextMultipleDiff(13, 10)],
        checkDigit: [U.computeCheckDigit('08100021'), U.computeCheckDigit('03100005')],
        dates: [U.formatDate(new FixedDate(Date.UTC(2026, 0, 5, 12))), U.formatTime(new FixedDate(Date.UTC(2026, 0, 5, 9, 7)))],
        business: [U.isBusinessDay(new FixedDate(Date.UTC(2026, 9, 31, 12))), U.isBusinessDay(new FixedDate(Date.UTC(2026, 10, 2, 12)))],
        computeBusinessDay: [String(U.computeBusinessDay(2, new FixedDate(Date.UTC(2026, 9, 30, 12))))]
    };
});

process.stdout.write(JSON.stringify(out, null, 1) + '\n');
