/* eslint-disable no-await-in-loop */
/* eslint-disable no-underscore-dangle */
const fetch = require('cross-fetch');
const { Op } = require('sequelize');
const {
  Teacher,
  Schedule,
  ScheduleItem,
  Location,
  School,
} = require('../models');

const mapVals = {
  Nashville: 'Nashville',
  nashville: 'Nashville',
  'Main Warehouse': 'Nashville',
  Antioch: 'Antioch',
  antioch: 'Antioch',
};
const regExpr = /\(([^)]+)\)/;
/**
 * Gets all appointments scheduled by teachers
 *
 * @param req - Express request object with the following params:
 *                req.query.startDate - start date of the schedule
 *                                      (i.e., the lower bound of scheduled appointments to fetch)
 *                req.query.end_date - end date of the schedule (the upper bound)
 * @param res - Express response object
 * @returns response object with status code and schedule data if successful. Returned data contains
 *          a list of scheduleItems, each of which contains all appointments for a given timeslot
 */

const getSchedule = async (req, res) => {
  const dateToString = (date) => {
    const day = date.getDate();
    const month = date.getMonth() + 1;
    const year = date.getFullYear();
    return `${month}/${day}/${year}`;
  };
  try {
    // sync with calendly first
    //syncAllAppointments(req, res);

    const scheduleWhereStatement = {
      _locationId: req.location._id,
    };
    if (req.query.startDate && req.query.endDate) {
      scheduleWhereStatement.start_date = {
        [Op.between]: [req.query.startDate, req.query.endDate],
      };
    } else {
      const today = new Date();
      const day = today.getDay();
      const diff = today.getDate() - day + (day === 0 ? -6 : 1);
      const first = new Date(today.setDate(diff));
      const last = new Date(today.setDate(diff + 6));
      scheduleWhereStatement.start_date = {
        [Op.between]: [dateToString(first), dateToString(last)],
      };
    }
    const schedule = await Schedule.findAll({
      order: [['start_date', 'ASC']],
      include: [
        {
          separate: true,
          model: ScheduleItem,
          include: [
            {
              model: Teacher,
              include: [
                {
                  model: School,
                },
              ],
            },
          ],
        },
      ],
      where: scheduleWhereStatement,
    });

    return res.status(200).json(schedule);
  } catch (err) {
    console.log(err);
    return { err: 'Error getting schedule' };
  }
};

/**
 * @param req --
 */
const addAppointment = async (req, res) => {
  try {
    const options = {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.SCHEDULER_BEARER_AUTH_TOKEN}`,
      },
    };
    console.log(req.body.payload.event);
    const event = await fetch(req.body.payload.event, options).then(
      (response) => response.json()
    );
    const eventName = regExpr.exec(event.resource.name);
    if (!eventName) {
      return res.status(200).json({ message: 'ignored' });
    }
    const location = await Location.findOne({
      where: {
        name: mapVals[eventName[1]],
      },
    });

    const [findSchedule] = await Schedule.findOrCreate({
      where: {
        start_date: event.resource.start_time,
        end_date: event.resource.end_time,
        _locationId: location._id,
      },
    });

    let schoolName = 'unspecified';
    // eslint-disable-next-line no-plusplus
    for (let k = 0; k < req.body.payload.questions_and_answers.length; ++k) {
      if (
        req.body.payload.questions_and_answers[k].position ===
        (location._id === 1 ? 1 : 0)
      )
        schoolName = req.body.payload.questions_and_answers[k].answer;
    }
    console.log(schoolName);

    const [findSchool] = await School.findOrCreate({
      where: {
        name: schoolName, // FIX BASED ON ACTUAL FORM
      },
      defaults: {
        verified: false,
      },
    });

    const [findTeacher] = await Teacher.findOrCreate({
      where: {
        email: req.body.payload.email,
      },
      defaults: {
        name: req.body.payload.name,
        _schoolId: findSchool._id,
      },
    });
    findTeacher.update({
      pencilId: findTeacher._id,
    });
    const newScheduleItem = await ScheduleItem.create({
      _scheduleId: findSchedule._id,
      _teacherId: findTeacher._id,
    });

    return res.status(200).json({ message: 'success' });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ err: 'Error adding appointment' });
  }
};

const cancelAppointment = async (req, res) => {
  const options = {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.SCHEDULER_BEARER_AUTH_TOKEN}`,
    },
  };
  const event = await fetch(req.body.payload.event, options).then((response) =>
    response.json()
  );
  try {
    const findSchedule = await Schedule.findOne({
      where: {
        start_date: event.resource.start_time,
        end_date: event.resource.end_time,
      },
      include: [{ model: ScheduleItem }],
    });
    const findTeacher = await Teacher.findOne({
      where: {
        email: req.body.payload.email,
      },
    });
    await ScheduleItem.destroy({
      where: {
        _scheduleId: findSchedule._id,
        _teacherId: findTeacher._id,
      },
    });
    if (findSchedule && findSchedule.ScheduleItems.length <= 1) {
      await findSchedule.destroy();
    }
    return res.status(200).json({ message: 'success' });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ err: 'Error canceling appointment' });
  }
};

function sleep(milliseconds) {
  const date = Date.now();
  let currentDate = null;
  do {
    currentDate = Date.now();
  } while (currentDate - date < milliseconds);
}

const moveFromNashvilleToAntioch = async (req, res) => {
  try {
    let hasNext = true;
    let url =
      'https://api.calendly.com/scheduled_events?count=100&min_start_time=2022-08-14T20%3A14%3A00.000000Z&organization=https%3A%2F%2Fapi.calendly.com%2Forganizations%2F17a13fb9-e6a5-4f1e-858a-6789b58b80aa&status=active&sort=start_time%3Aasc';
    while (hasNext) {
      const options = {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.SCHEDULER_BEARER_AUTH_TOKEN}`,
        },
      };
      const event = await fetch(url, options).then((response) =>
        response.json()
      );
      // console.log(event);
      // eslint-disable-next-line no-plusplus
      for (let i = 0; i < event.collection.length; ++i) {
        const eventInfo = event.collection[i];
        console.log(mapVals[regExpr.exec(eventInfo.name)[1]]);
        const location = await Location.findOne({
          where: {
            name: mapVals[regExpr.exec(eventInfo.name)[1]],
          },
        });
        console.log(location._id);
        if (location._id === 2) {
          const inviteeevent = await fetch(
            `${eventInfo.uri}/invitees?status=active`,
            options
          ).then((response) => response.json());
          // console.log('event', inviteeevent);
          const findSchedule = await Schedule.findOne({
            where: {
              start_date: eventInfo.start_time,
              end_date: eventInfo.end_time,
            },
          });
          await findSchedule.update({ _locationId: 2 });
          // eslint-disable-next-line no-plusplus
          for (let j = 0; j < inviteeevent.collection.length; ++j) {
            const invitee = inviteeevent.collection[j];
            console.log('Q&A', invitee.questions_and_answers);

            let schoolName = 'unspecified';
            // eslint-disable-next-line no-plusplus
            for (let k = 0; k < invitee.questions_and_answers.length; ++k) {
              if (invitee.questions_and_answers[k].position === 0)
                schoolName = invitee.questions_and_answers[k].answer;
            }
            console.log(schoolName);

            const [findSchool] = await School.findOrCreate({
              where: {
                name: schoolName, // FIX BASED ON ACTUAL FORM
              },
              defaults: {
                verified: false,
              },
            });

            const findTeacher = await Teacher.findOne({
              where: {
                email: invitee.email,
              },
            });
            await findTeacher.update({ _schoolId: findSchool._id });
          }
          const delay = Math.floor(Math.random() * 20) + 2;
          console.log(delay);
          sleep(delay * 1000);
        }
      }
      if (event.pagination.next_page) {
        const newEvent = await fetch(url, options).then((response) =>
          response.json()
        );
        url = newEvent.pagination.next_page;
      } else {
        hasNext = false;
        break;
      }
      const delay = Math.floor(Math.random() * 20) + 2;
      console.log(delay);
      sleep(delay * 1000);
    }
    return res.status(200);
  } catch (err) {
    console.log(err);
    return res.status(500).json({ err: 'Error syncing appointments' });
  }
};

const syncAllAppointments = async (req, res) => {
  try {
    let hasNext = true;
    let start_time = req.query.startDate;
    let url =
      `https://api.calendly.com/scheduled_events?count=100&min_start_time=${start_time}&organization=https://api.calendly.com/organizations/${process.env.CALENDLY_ORGANIZATION_UUID}&status=active&sort=start_time:asc`;
    while (hasNext) {
      const options = {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.SCHEDULER_BEARER_AUTH_TOKEN}`,
        },
      };
      const event = await fetch(url, options).then((response) =>
        response.json()
      );
      console.log('lol', event);
      // eslint-disable-next-line no-plusplus
      for (let i = 0; i < event.collection.length; ++i) {
        const eventInfo = event.collection[i];
        console.log(eventInfo.name);
        const curName = regExpr.exec(eventInfo.name);
        if (curName) {
          const location = await Location.findOne({
            name: mapVals[regExpr.exec(eventInfo.name)[1]],
          });
          const inviteeevent = await fetch(
            `${eventInfo.uri}/invitees?status=active`,
            options
          ).then((response) => response.json());
          console.log('event', inviteeevent);
          const [findSchedule, created] = await Schedule.findOrCreate({
            where: {
              start_date: eventInfo.start_time,
              end_date: eventInfo.end_time,
              _locationId: location._id,
            },
          });
          if (created) {
            // eslint-disable-next-line no-plusplus
            for (let j = 0; j < inviteeevent.collection.length; ++j) {
              const invitee = inviteeevent.collection[j];

              let schoolName = 'unspecified';
              // eslint-disable-next-line no-plusplus
              for (let k = 0; k < invitee.questions_and_answers.length; ++k) {
                if (invitee.questions_and_answers[k].position === 1)
                  schoolName = invitee.questions_and_answers[k].answer;
              }
              console.log(schoolName);

              const [findSchool] = await School.findOrCreate({
                where: {
                  name: schoolName, // FIX BASED ON ACTUAL FORM
                },
                defaults: {
                  verified: false,
                },
              });

              const [findTeacher] = await Teacher.findOrCreate({
                where: {
                  email: invitee.email,
                },
                defaults: {
                  name: invitee.name,
                  _schoolId: findSchool._id,
                },
              });
              findTeacher.update({
                pencilId: findTeacher._id,
              });
              const newScheduleItem = await ScheduleItem.create({
                _scheduleId: findSchedule._id,
                _teacherId: findTeacher._id,
              });
            }
          } else {
            const schedule = await Schedule.findAll({
              raw: true,
              include: [
                {
                  model: ScheduleItem,
                  include: [
                    {
                      model: Teacher,
                      include: [
                        {
                          model: School,
                        },
                      ],
                    },
                  ],
                },
              ],
              where: {
                start_date: eventInfo.start_time,
                end_date: eventInfo.end_time,
                _locationId: location._id,
              },
            });
            // eslint-disable-next-line no-plusplus
            for (let k = 0; k < schedule.length; ++k) {
              let findVal = false;
              // eslint-disable-next-line no-plusplus
              for (let j = 0; j < inviteeevent.collection.length; ++j) {
                if (
                  inviteeevent.collection[j].email ===
                  schedule[k]['ScheduleItems.Teacher.email']
                ) {
                  findVal = true;
                  break;
                }
              }
              if (!findVal) {
                await ScheduleItem.destroy({
                  where: {
                    _id: schedule[k]['ScheduleItems._id'],
                  },
                });
              }
            }
            // eslint-disable-next-line no-plusplus
            for (let j = 0; j < inviteeevent.collection.length; ++j) {
              let findVal = false;
              // eslint-disable-next-line no-plusplus
              for (let d = 0; d < schedule.length; ++d) {
                if (
                  inviteeevent.collection[j].email ===
                  schedule[d]['ScheduleItems.Teacher.email']
                ) {
                  findVal = true;
                  break;
                }
              }
              if (!findVal) {
                const invitee = inviteeevent.collection[j];
                console.log('Q&A', invitee.questions_and_answers);

                let schoolName = 'unspecified';
                // eslint-disable-next-line no-plusplus
                for (let k = 0; k < invitee.questions_and_answers.length; ++k) {
                  if (invitee.questions_and_answers[k].position === 1)
                    schoolName = invitee.questions_and_answers[k].answer;
                }
                console.log(schoolName);

                const [findSchool] = await School.findOrCreate({
                  where: {
                    name: schoolName, // FIX BASED ON ACTUAL FORM
                  },
                  defaults: {
                    verified: false,
                  },
                });

                const [findTeacher] = await Teacher.findOrCreate({
                  where: {
                    email: invitee.email,
                  },
                  defaults: {
                    name: invitee.name,
                    _schoolId: findSchool._id,
                  },
                });
                findTeacher.update({
                  pencilId: findTeacher._id,
                });
                const newScheduleItem = await ScheduleItem.create({
                  _scheduleId: findSchedule._id,
                  _teacherId: findTeacher._id,
                });
              }
            }
          }
        }
        //const delay = Math.floor(Math.random() * 20) + 2;
        //console.log('bidenzz', delay);
        sleep(1000);
      }
      if (event.pagination.next_page) {
        const newEvent = await fetch(url, options).then((response) =>
          response.json()
        );
        url = newEvent.pagination.next_page;
      } else {
        hasNext = false;
        break;
      }
      //const delay = Math.floor(Math.random() * 20) + 2;
      //console.log(delay);
      sleep(1000);
    }
    return res.status(204);
  } catch (err) {
    console.log(err);
    return res.status(500).json({ err: 'Error syncing appointments' });
  }
};

const fakeAppointment = async (req, res) => {
  try {
    const location = await Location.findOne({
      name: req.body.location,
    });
    const [findSchedule] = await Schedule.findOrCreate({
      where: {
        start_date: req.body.start_time,
        end_date: req.body.end_time,
        _locationId: location._id,
      },
    });

    const [findSchool] = await School.findOrCreate({
      where: {
        name: req.body.school, // FIX BASED ON ACTUAL FORM
      },
      defaults: {
        verified: false,
      },
    });

    const [findTeacher] = await Teacher.findOrCreate({
      where: {
        email: req.body.teacher.email,
      },
      defaults: {
        name: req.body.teacher.name,
        _schoolId: findSchool._id,
      },
    });
    findTeacher.update({
      pencilId: findTeacher._id,
    });
    const newScheduleItem = await ScheduleItem.create({
      _scheduleId: findSchedule._id,
      _teacherId: findTeacher._id,
    });

    return res.status(200).json({
      message: 'Successfully added fake appointment',
    });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ err: 'Error adding appointment' });
  }
};

module.exports = {
  addAppointment,
  cancelAppointment,
  getSchedule,
  fakeAppointment,
  syncAllAppointments,
  moveFromNashvilleToAntioch,
};
