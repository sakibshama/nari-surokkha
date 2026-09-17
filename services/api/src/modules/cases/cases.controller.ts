import { FastifyRequest, FastifyReply } from 'fastify';
import { CasesService } from './cases.service';

export class CasesController {
  constructor(private readonly service: CasesService) {}

  listCases = async (req: FastifyRequest<{ Querystring: { status?: string } }>, reply: FastifyReply) => {
    const stationId = req.user?.stationId || '';
    const cases = await this.service.getStationCases(stationId, req.query.status);
    return reply.send({ data: cases });
  };

  getCase = async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const stationId = req.user?.stationId || '';
    const caseData = await this.service.getCaseDetails(req.params.id, stationId);
    return reply.send({ data: caseData });
  };

  getTimeline = async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const stationId = req.user?.stationId || '';
    const timeline = await this.service.getCaseTimeline(req.params.id, stationId);
    return reply.send({ data: timeline });
  };

  assignOfficer = async (req: FastifyRequest<{ Params: { id: string }, Body: { officerId: string, note?: string } }>, reply: FastifyReply) => {
    const userId = req.user?.id || '';
    const stationId = req.user?.stationId || '';
    const updated = await this.service.assignOfficer(req.params.id, req.body.officerId, userId, stationId, req.body.note);
    return reply.send({ message: 'Officer assigned', data: updated });
  };

  updateStatus = async (req: FastifyRequest<{ Params: { id: string }, Body: { status: string, note?: string, closedReason?: string } }>, reply: FastifyReply) => {
    const userId = req.user?.id || '';
    const stationId = req.user?.stationId || '';
    const updated = await this.service.updateStatus(req.params.id, req.body.status, userId, stationId, req.body.note, req.body.closedReason);
    return reply.send({ message: 'Status updated', data: updated });
  };

  addNote = async (req: FastifyRequest<{ Params: { id: string }, Body: { note: string } }>, reply: FastifyReply) => {
    const userId = req.user?.id || '';
    const stationId = req.user?.stationId || '';
    const update = await this.service.addNote(req.params.id, userId, stationId, req.body.note);
    return reply.send({ message: 'Note added', data: update });
  };

  exportReport = async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const stationId = req.user?.stationId || '';
    const reportText = await this.service.generateCaseReport(req.params.id, stationId);
    reply.header('Content-Disposition', `attachment; filename="case_report_${req.params.id}.txt"`);
    reply.type('text/plain');
    return reply.send(reportText);
  };
}
